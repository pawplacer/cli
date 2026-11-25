import { CliUsageError } from "../errors";
import {
  type Choice,
  choicesFrom,
  DEFAULT_PET_STATUSES,
  PET_AGE_CATEGORIES,
  PET_COMPATIBILITIES,
  PET_HEALTH,
  PET_SEXES,
  PET_SIZES,
  PET_SPECIES,
  PET_TEMPERAMENTS,
} from "../constants";
import { type PromptAdapter, splitList } from "./adapter";
import {
  type CustomFieldOption,
  findCustomFieldOptions,
  isPetColumnField,
  normalizeCustomFields,
  promptForCustomFieldsPayload,
} from "./custom-fields";

type Mode = "create" | "update";

const SKIP = Symbol("skip");
const OTHER_STATUS = "__other_status__";
const NOT_SET = "__not_set__";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface FieldContext {
  medicalOptions: CustomFieldOption[];
  mode: Mode;
  prompts: PromptAdapter;
}

interface PetField {
  ask: (context: FieldContext) => Promise<unknown>;
  key: string;
  label: string;
}

function clearMessage(label: string, mode: Mode) {
  return mode === "update" ? `${label} (leave blank to clear)` : label;
}

function text(
  key: string,
  label: string,
  options: { date?: boolean; required?: boolean } = {},
): PetField {
  return {
    key,
    label,
    ask: async ({ mode, prompts }) => {
      const message = options.required
        ? label
        : clearMessage(options.date ? `${label} (YYYY-MM-DD)` : label, mode);
      const value = (
        await prompts.input({
          message,
          required: options.required,
          validate: options.date
            ? (entry: string) =>
                !entry.trim() ||
                DATE_PATTERN.test(entry.trim()) ||
                "Use YYYY-MM-DD"
            : undefined,
        })
      ).trim();
      if (value) {
        return value;
      }
      return mode === "update" && !options.required ? "" : SKIP;
    },
  };
}

function list(key: string, label: string): PetField {
  return {
    key,
    label,
    ask: async ({ mode, prompts }) => {
      const values = splitList(
        await prompts.input({
          message: clearMessage(`${label}, comma-separated`, mode),
        }),
      );
      if (values.length) {
        return values;
      }
      return mode === "update" ? [] : SKIP;
    },
  };
}

function multi(key: string, label: string, values: readonly string[]) {
  return {
    key,
    label,
    ask: async ({ mode, prompts }: FieldContext) => {
      const picked = await prompts.checkbox({
        message: label,
        choices: choicesFrom(values),
        pageSize: 15,
      });
      if (picked.length) {
        return picked;
      }
      return mode === "update" ? [] : SKIP;
    },
  } satisfies PetField;
}

function pick(
  key: string,
  label: string,
  choices: readonly Choice[],
  options: { optional?: boolean } = {},
): PetField {
  return {
    key,
    label,
    ask: async ({ prompts }) => {
      const value = await prompts.select({
        message: label,
        choices: options.optional
          ? [...choices, { name: "Not set", value: NOT_SET }]
          : choices,
      });
      return value === NOT_SET ? SKIP : value;
    },
  };
}

function yesNo(key: string, label: string, defaultValue: boolean): PetField {
  return {
    key,
    label,
    ask: ({ prompts }) =>
      prompts.confirm({ message: label, default: defaultValue }),
  };
}

const statusField: PetField = {
  key: "status",
  label: "Status",
  ask: async ({ prompts }) => {
    const value = await prompts.select({
      message: "Status",
      choices: [
        ...choicesFrom(DEFAULT_PET_STATUSES),
        {
          name: "Another status (type its name, label, or ID)",
          value: OTHER_STATUS,
        },
      ],
      default: "available",
      pageSize: 14,
    });
    if (value !== OTHER_STATUS) {
      return value;
    }
    return (
      await prompts.input({
        message: "Status name, label, or ID",
        required: true,
      })
    ).trim();
  },
};

const adoptionFeeField: PetField = {
  key: "adoption_fee",
  label: "Adoption fee",
  ask: async ({ prompts }) => {
    const value = await prompts.number({ message: "Adoption fee" });
    return typeof value === "number" && Number.isFinite(value) ? value : SKIP;
  },
};

const specialNeedsField: PetField = {
  key: "special_needs",
  label: "Medical conditions / special needs",
  ask: async (context) => {
    if (!context.medicalOptions.length) {
      return list("special_needs", "Medical conditions / special needs").ask(
        context,
      );
    }
    const picked = await context.prompts.checkbox({
      message: "Medical conditions / special needs",
      choices: context.medicalOptions.map((option) => ({
        name: option.label,
        value: typeof option.value === "string" ? option.value : option.label,
      })),
      pageSize: 12,
    });
    if (picked.length) {
      return picked;
    }
    return context.mode === "update" ? [] : SKIP;
  },
};

const CORE_FIELDS: PetField[] = [
  text("name", "Pet name", { required: true }),
  pick("species", "Species", PET_SPECIES),
  pick("age_category", "Age category", PET_AGE_CATEGORIES),
  pick("sex", "Sex", PET_SEXES),
  pick("size", "Size", PET_SIZES),
  statusField,
];

const BASIC_FIELDS: PetField[] = [
  pick("health", "Health", PET_HEALTH, { optional: true }),
  list("breed", "Breeds"),
  adoptionFeeField,
  text("description", "Description"),
];

const DETAIL_FIELDS: PetField[] = [
  list("color", "Colors"),
  text("age_years", "Age in years"),
  text("age_months", "Age in months"),
  text("age_birthday", "Birthday", { date: true }),
  yesNo("spayed", "Spayed/neutered?", false),
  text("microchip_id", "Microchip ID"),
  multi("good_with", "Good with", PET_COMPATIBILITIES),
  multi("bad_with", "Bad with", PET_COMPATIBILITIES),
  multi("temperaments", "Temperaments", PET_TEMPERAMENTS),
  specialNeedsField,
  list("image_urls", "Image URLs"),
  text("coat_length", "Coat length"),
  text("custom_id", "Custom ID"),
  text("intake_date", "Intake date", { date: true }),
  text("outcome_date", "Outcome date", { date: true }),
  text("weight", "Weight"),
  text("status_change_notes", "Status change notes"),
];

const SHOW_PUBLIC_FIELD = yesNo("show_public", "Show publicly?", true);
const CUSTOM_FIELDS_KEY = "custom_field_data";

async function collect(
  fields: PetField[],
  context: FieldContext,
  payload: Record<string, unknown>,
) {
  for (const field of fields) {
    const value = await field.ask(context);
    if (value !== SKIP) {
      payload[field.key] = value;
    }
  }
}

async function loadCustomFieldContext(load: () => Promise<unknown>) {
  const response = await load();
  return {
    customFields: normalizeCustomFields(response, isPetColumnField),
    medicalOptions: findCustomFieldOptions(response, [
      "Medical Conditions",
      "Special Needs",
    ]),
  };
}

export async function promptForPetCreate(
  prompts: PromptAdapter,
  loadCustomFields: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const { customFields, medicalOptions } =
    await loadCustomFieldContext(loadCustomFields);
  const context: FieldContext = { medicalOptions, mode: "create", prompts };
  const payload: Record<string, unknown> = {};

  await collect([...CORE_FIELDS, ...BASIC_FIELDS], context, payload);

  const detailKeys = new Set(
    await prompts.checkbox({
      message: "Add more details? (space to select, enter to continue)",
      choices: DETAIL_FIELDS.map((field) => ({
        name: field.label.replace(/\?$/, ""),
        value: field.key,
      })),
      pageSize: 17,
    }),
  );
  await collect(
    DETAIL_FIELDS.filter((field) => detailKeys.has(field.key)),
    context,
    payload,
  );

  payload.show_public = await SHOW_PUBLIC_FIELD.ask(context);

  const customFieldData = await promptForCustomFieldsPayload(
    prompts,
    customFields,
  );
  if (Object.keys(customFieldData).length) {
    payload[CUSTOM_FIELDS_KEY] = customFieldData;
  }
  return payload;
}

export async function promptForPetUpdate(
  prompts: PromptAdapter,
  loadCustomFields: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const { customFields, medicalOptions } =
    await loadCustomFieldContext(loadCustomFields);
  const context: FieldContext = { medicalOptions, mode: "update", prompts };
  const fields = [
    ...CORE_FIELDS,
    ...BASIC_FIELDS,
    ...DETAIL_FIELDS,
    SHOW_PUBLIC_FIELD,
  ];
  const selected = new Set(
    await prompts.checkbox({
      message: "Fields to update (space to select, enter to continue)",
      choices: [
        ...fields.map((field) => ({
          name: field.label.replace(/\?$/, ""),
          value: field.key,
        })),
        { name: "Custom fields", value: CUSTOM_FIELDS_KEY },
      ],
      pageSize: 18,
    }),
  );
  if (!selected.size) {
    throw new CliUsageError("Select at least one field to update.");
  }

  const payload: Record<string, unknown> = {};
  await collect(
    fields.filter((field) => selected.has(field.key)),
    context,
    payload,
  );

  if (selected.has(CUSTOM_FIELDS_KEY)) {
    const customFieldData = await promptForCustomFieldsPayload(
      prompts,
      customFields.map((field) => ({ ...field, required: false })),
    );
    if (Object.keys(customFieldData).length) {
      payload[CUSTOM_FIELDS_KEY] = customFieldData;
    }
  }
  return payload;
}
