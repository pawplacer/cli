import { humanize } from "../constants";
import type { PromptAdapter } from "./adapter";

const PET_COLUMN_FIELD_KEYS = new Set([
  "adoption_fee",
  "age",
  "age_category",
  "age_months",
  "age_years",
  "alternative_names",
  "bad_with",
  "breed",
  "breeds",
  "coat_length",
  "color",
  "colors",
  "custom_id",
  "custom_status_id",
  "description",
  "good_with",
  "health",
  "image_urls",
  "intake_date",
  "medical_conditions",
  "microchip_id",
  "name",
  "outcome_date",
  "photos",
  "photos_videos",
  "primary_veterinarian",
  "primary_veterinarian_id",
  "sex",
  "show_public",
  "size",
  "spayed",
  "spayed_neutered",
  "special_needs",
  "species",
  "status",
  "tag_ids",
  "tags",
  "temperaments",
  "weight",
]);
const PET_COLUMN_FIELD_LABELS = new Set([
  "adoption fee",
  "age",
  "alternative names",
  "bad with",
  "breed",
  "coat length",
  "color",
  "custom id",
  "description",
  "good with",
  "health",
  "intake date",
  "medical conditions",
  "microchip id",
  "name",
  "outcome date",
  "photos",
  "photos/videos",
  "primary veterinarian",
  "sex",
  "show public",
  "size",
  "spayed/neutered",
  "special needs",
  "species",
  "status",
  "tags",
  "temperaments",
  "weight",
]);
const PERSON_COLUMN_FIELD_KEYS = new Set([
  "address",
  "capacity",
  "email",
  "email_address",
  "foster_capacity",
  "full_name",
  "name",
  "phone",
  "phone_number",
  "status",
]);
const PERSON_COLUMN_FIELD_LABELS = new Set([
  "address",
  "email",
  "email address",
  "foster capacity",
  "full name",
  "name",
  "phone",
  "phone number",
  "status",
]);
const CUSTOM_FIELDS_DONE = "__pawplacer_done__";

export interface CustomFieldOption {
  label: string;
  value: unknown;
}

export interface NormalizedCustomField {
  fieldKey: string;
  fieldType: string;
  fieldOrder?: number;
  helpText?: string;
  label: string;
  options: CustomFieldOption[];
  placeholder?: string;
  required: boolean;
  section?: string;
  sectionOrder?: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function optionLabel(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function normalizeOption(option: unknown): CustomFieldOption | undefined {
  if (isRecord(option)) {
    const value =
      option.value ??
      option.key ??
      option.id ??
      option.slug ??
      option.label ??
      option.name;
    const label =
      optionLabel(option.label) ||
      optionLabel(option.name) ||
      optionLabel(option.title) ||
      optionLabel(option.value) ||
      optionLabel(option.key) ||
      optionLabel(option.id);

    if (label) {
      return { label, value: value ?? label };
    }
    return undefined;
  }

  const label = optionLabel(option);
  return label ? { label, value: option } : undefined;
}

function normalizeOptions(options: unknown): CustomFieldOption[] {
  if (Array.isArray(options)) {
    return options.flatMap((option) => {
      const normalized = normalizeOption(option);
      return normalized ? [normalized] : [];
    });
  }

  if (isRecord(options)) {
    return Object.entries(options).flatMap(([key, value]) => {
      if (isRecord(value)) {
        const normalized = normalizeOption({ key, ...value });
        return normalized ? [normalized] : [];
      }

      const label = optionLabel(value) || humanize(key);
      return [{ label, value: key }];
    });
  }

  return [];
}

export function findCustomFieldOptions(
  fields: unknown,
  labels: string[],
): CustomFieldOption[] {
  const labelSet = new Set(labels.map(normalizeToken));
  const rawFields = Array.isArray(fields)
    ? fields
    : isRecord(fields) && Array.isArray(fields.custom_fields)
      ? fields.custom_fields
      : [];

  for (const field of rawFields) {
    if (!isRecord(field)) {
      continue;
    }
    const label = optionLabel(field.label);
    if (label && labelSet.has(normalizeToken(label))) {
      return normalizeOptions(field.options);
    }
  }

  return [];
}

export function isPetColumnField(
  fieldKey: string,
  label: string,
  syncToColumn?: string,
): boolean {
  const normalizedKey = normalizeToken(fieldKey).replace(/\s+/g, "_");
  const normalizedLabel = normalizeToken(label);
  const normalizedColumn = syncToColumn
    ? normalizeToken(syncToColumn).replace(/\s+/g, "_")
    : undefined;
  return (
    PET_COLUMN_FIELD_KEYS.has(normalizedKey) ||
    (normalizedColumn !== undefined &&
      PET_COLUMN_FIELD_KEYS.has(normalizedColumn)) ||
    PET_COLUMN_FIELD_LABELS.has(normalizedLabel)
  );
}

export function isPersonColumnField(
  fieldKey: string,
  label: string,
  syncToColumn?: string,
): boolean {
  const normalizedKey = normalizeToken(fieldKey).replace(/\s+/g, "_");
  const normalizedLabel = normalizeToken(label);
  const normalizedColumn = syncToColumn
    ? normalizeToken(syncToColumn).replace(/\s+/g, "_")
    : undefined;
  return (
    PERSON_COLUMN_FIELD_KEYS.has(normalizedKey) ||
    (normalizedColumn !== undefined &&
      PERSON_COLUMN_FIELD_KEYS.has(normalizedColumn)) ||
    PERSON_COLUMN_FIELD_LABELS.has(normalizedLabel)
  );
}

export function normalizeCustomFields(
  fields: unknown,
  shouldSkipField?: (
    fieldKey: string,
    label: string,
    syncToColumn?: string,
  ) => boolean,
): NormalizedCustomField[] {
  const rawFields = Array.isArray(fields)
    ? fields
    : isRecord(fields) && Array.isArray(fields.custom_fields)
      ? fields.custom_fields
      : [];

  return rawFields
    .flatMap((field) => {
      if (
        !isRecord(field) ||
        field.hidden === true ||
        field.internal_only === true
      ) {
        return [];
      }

      const fieldKey = optionLabel(field.field_key);
      if (!fieldKey) {
        return [];
      }

      const fieldType = optionLabel(field.field_type).toLowerCase();
      const label = optionLabel(field.label) || humanize(fieldKey);
      const syncToColumn = optionLabel(field.sync_to_column) || undefined;
      if (shouldSkipField?.(fieldKey, label, syncToColumn)) {
        return [];
      }

      const helpText = optionLabel(field.help_text) || undefined;
      const placeholder = optionLabel(field.placeholder) || undefined;
      const section = optionLabel(field.section) || undefined;
      const sectionOrder =
        typeof field.section_order === "number" &&
        Number.isFinite(field.section_order)
          ? field.section_order
          : undefined;
      const fieldOrder =
        typeof field.field_order === "number" &&
        Number.isFinite(field.field_order)
          ? field.field_order
          : undefined;

      return [
        {
          fieldKey,
          fieldType,
          fieldOrder,
          helpText,
          label,
          options: normalizeOptions(field.options),
          placeholder,
          required: field.required === true,
          section,
          sectionOrder,
        },
      ];
    })
    .sort(
      (left, right) =>
        (left.sectionOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.sectionOrder ?? Number.MAX_SAFE_INTEGER) ||
        (left.fieldOrder ?? Number.MAX_SAFE_INTEGER) -
          (right.fieldOrder ?? Number.MAX_SAFE_INTEGER),
    );
}

function formatCustomFieldName(field: NormalizedCustomField): string {
  const prefix = field.section ? `${field.section}: ` : "";
  const suffix = field.required ? " (required)" : "";
  return `${prefix}${field.label}${suffix}`;
}

function formatCustomFieldDescription(
  field: NormalizedCustomField,
): string | undefined {
  const parts = [
    field.helpText,
    field.placeholder ? `Example: ${field.placeholder}` : undefined,
    field.options.length
      ? `Options: ${field.options
          .slice(0, 8)
          .map((option) => option.label)
          .join(", ")}${field.options.length > 8 ? ", ..." : ""}`
      : undefined,
  ].filter(Boolean);

  return parts.length ? parts.join(" ") : undefined;
}

function isMultiChoiceField(fieldType: string): boolean {
  return (
    fieldType.includes("multi") ||
    fieldType.includes("checkbox") ||
    fieldType.includes("tags")
  );
}

function isBooleanField(fieldType: string): boolean {
  return (
    fieldType.includes("bool") ||
    fieldType === "yes_no" ||
    fieldType === "toggle" ||
    fieldType === "switch"
  );
}

function isNumberField(fieldType: string): boolean {
  return (
    fieldType.includes("number") ||
    fieldType.includes("integer") ||
    fieldType.includes("decimal") ||
    fieldType.includes("currency")
  );
}

async function promptForCustomFieldValue(
  prompts: PromptAdapter,
  field: NormalizedCustomField,
): Promise<unknown> {
  const message = formatCustomFieldName(field);

  if (field.options.length && isMultiChoiceField(field.fieldType)) {
    return prompts.checkbox({
      message,
      choices: field.options.map((option) => ({
        name: option.label,
        value: option.value,
      })),
      required: field.required,
    });
  }

  if (field.options.length) {
    return prompts.select({
      message,
      choices: field.options.map((option) => ({
        name: option.label,
        value: option.value,
      })),
    });
  }

  if (isBooleanField(field.fieldType)) {
    return prompts.confirm({
      message,
      default: false,
    });
  }

  if (isNumberField(field.fieldType)) {
    return prompts.number({
      message,
      required: field.required,
    });
  }

  return prompts.input({
    message: field.placeholder ? `${message} (${field.placeholder})` : message,
    default: "",
    required: field.required,
  });
}

export async function promptForCustomFieldsPayload(
  prompts: PromptAdapter,
  fields: NormalizedCustomField[],
): Promise<Record<string, unknown>> {
  if (!fields.length) {
    return {};
  }

  const requiredFields = fields.filter((field) => field.required);
  const optionalFields = fields.filter((field) => !field.required);
  const customFieldData: Record<string, unknown> = {};

  for (const field of requiredFields) {
    const value = await promptForCustomFieldValue(prompts, field);
    if (
      field.required ||
      (Array.isArray(value) && value.length > 0) ||
      (typeof value === "string" && value.trim()) ||
      (typeof value !== "string" && value !== undefined && value !== null)
    ) {
      customFieldData[field.fieldKey] =
        typeof value === "string" ? value.trim() : value;
    }
  }

  const remainingOptionalFields = [...optionalFields];
  while (remainingOptionalFields.length) {
    const selectedFieldKey = await prompts.select({
      message: "Add custom field",
      choices: [
        ...remainingOptionalFields.map((field) => ({
          name: formatCustomFieldName(field),
          value: field.fieldKey,
          description: formatCustomFieldDescription(field),
        })),
        { name: "Done adding custom fields", value: CUSTOM_FIELDS_DONE },
      ],
      pageSize: 12,
    });

    if (selectedFieldKey === CUSTOM_FIELDS_DONE) {
      break;
    }

    const selectedIndex = remainingOptionalFields.findIndex(
      (field) => field.fieldKey === selectedFieldKey,
    );
    const field = remainingOptionalFields[selectedIndex];
    if (!field) {
      break;
    }

    remainingOptionalFields.splice(selectedIndex, 1);
    const value = await promptForCustomFieldValue(prompts, field);
    if (
      (Array.isArray(value) && value.length > 0) ||
      (typeof value === "string" && value.trim()) ||
      (typeof value !== "string" && value !== undefined && value !== null)
    ) {
      customFieldData[field.fieldKey] =
        typeof value === "string" ? value.trim() : value;
    }
  }

  return customFieldData;
}
