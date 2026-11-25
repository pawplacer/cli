import chalk from "chalk";
import type { ContractType, PersonType } from "pawplacer-sdk";

import {
  choicesFrom,
  humanize,
  PERSON_CREATE_STATUSES,
  PERSON_TYPES,
} from "../constants";
import { CliUsageError } from "../errors";
import type { Writable } from "../output";
import { type PromptAdapter, splitList } from "./adapter";
import {
  isPersonColumnField,
  isRecord,
  normalizeCustomFields,
  optionLabel,
  promptForCustomFieldsPayload,
} from "./custom-fields";

const MAX_APPLICATION_PETS = 5;
const VOLUNTEER_LIST_FIELDS = [
  ["skills", "Skills"],
  ["interests", "Interests"],
  ["preferred_roles", "Preferred roles"],
  ["languages", "Languages"],
] as const;

export interface PersonPromptDeps {
  loadContract: (type: ContractType) => Promise<unknown>;
  loadCustomFields: (type: PersonType) => Promise<unknown>;
  stderr: Writable;
}

export function personTypeChoices() {
  return PERSON_TYPES.map((value) => ({ name: humanize(value), value }));
}

async function promptForApplication(
  prompts: PromptAdapter,
  type: "adopter" | "foster",
  deps: PersonPromptDeps,
) {
  const contract = await deps.loadContract(type);
  const content = isRecord(contract) ? optionLabel(contract.content) : "";
  if (!content) {
    throw new CliUsageError(
      `Couldn't load the ${type} contract, so the application can't be submitted.`,
    );
  }
  deps.stderr.write(
    `\n${chalk.bold(`${humanize(type)} contract`)}\n${content}\n\n`,
  );

  const petIds = splitList(
    await prompts.input({
      message: `PawPlacer pet IDs, comma-separated (1-${MAX_APPLICATION_PETS})`,
      required: true,
    }),
  );
  if (petIds.length < 1 || petIds.length > MAX_APPLICATION_PETS) {
    throw new CliUsageError(
      `Applications need between 1 and ${MAX_APPLICATION_PETS} pet IDs.`,
    );
  }
  if (new Set(petIds).size !== petIds.length) {
    throw new CliUsageError("Application pet IDs must be unique.");
  }
  const termsAccepted = await prompts.confirm({
    message: `Did the applicant accept the ${type} contract shown above?`,
    default: false,
  });
  if (!termsAccepted) {
    throw new CliUsageError(
      "The applicant has to accept the contract before the application is submitted.",
    );
  }
  return { pet_ids: petIds, terms_accepted: true };
}

export async function promptForPersonCreate(
  prompts: PromptAdapter,
  deps: PersonPromptDeps,
): Promise<Record<string, unknown>> {
  const type = await prompts.select({
    message: "Person type",
    choices: personTypeChoices(),
  });
  const customFields = normalizeCustomFields(
    await deps.loadCustomFields(type),
    isPersonColumnField,
  );
  const payload: Record<string, unknown> = {
    type,
    name: (await prompts.input({ message: "Name", required: true })).trim(),
  };

  for (const [field, label] of [
    ["email", "Email"],
    ["phone", "Phone"],
    ["address", "Address"],
  ] as const) {
    const value = (await prompts.input({ message: label })).trim();
    if (value) {
      payload[field] = value;
    }
  }

  const isApplication =
    (type === "adopter" || type === "foster") &&
    (await prompts.confirm({
      message: "Submit this person as an application for specific pets?",
      default: false,
    }));

  if (isApplication) {
    payload.status = "pending";
    payload.application = await promptForApplication(prompts, type, deps);
  } else {
    payload.status = await prompts.select({
      message: "Status",
      choices: choicesFrom(
        PERSON_CREATE_STATUSES.filter(
          (status) => type !== "adopter" || status !== "training",
        ),
      ),
      default: type === "adopter" ? "active" : "pending",
    });
  }

  if (type === "foster") {
    const capacity = await prompts.number({ message: "Foster capacity" });
    if (typeof capacity === "number" && Number.isFinite(capacity)) {
      payload.capacity = capacity;
    }
  }

  if (type === "volunteer") {
    for (const [field, label] of VOLUNTEER_LIST_FIELDS) {
      const values = splitList(
        await prompts.input({ message: `${label}, comma-separated` }),
      );
      if (values.length) {
        payload[field] = values;
      }
    }
  }

  const customFieldData = await promptForCustomFieldsPayload(
    prompts,
    customFields,
  );
  if (Object.keys(customFieldData).length) {
    payload.custom_field_data = customFieldData;
  }
  return payload;
}
