import chalk from "chalk";
import type {
  AdoptionFeeEntry,
  ContractResponse,
  CustomField,
  PaginatedResponse,
  Person,
  Pet,
} from "pawplacer-sdk";

import { humanize, PET_SPECIES } from "./constants";

export type Writable = Pick<NodeJS.WriteStream, "write">;

export type View =
  | "adoption-fees"
  | "contract"
  | "custom-fields"
  | "doctor"
  | "person"
  | "person-list"
  | "pet"
  | "pet-list";

export interface OutputMode {
  compact: boolean;
  json: boolean;
}

export interface Rendered {
  value: unknown;
  view: View;
}

const MAX_CELL_WIDTH = 40;
const SPECIES_LABELS = new Map<string, string>(
  PET_SPECIES.map((species) => [species.value, species.name]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function display(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (Array.isArray(value)) {
    const items = value.map(display).filter(Boolean);
    return items.length ? items.join(", ") : undefined;
  }
  if (isRecord(value)) {
    return Object.keys(value).length ? JSON.stringify(value) : undefined;
  }
  return String(value);
}

function truncate(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.min(
      MAX_CELL_WIDTH,
      Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
    ),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) =>
        index === cells.length - 1
          ? truncate(cell, widths[index] ?? MAX_CELL_WIDTH)
          : truncate(cell, widths[index] ?? MAX_CELL_WIDTH).padEnd(
              widths[index] ?? 0,
            ),
      )
      .join("  ")
      .trimEnd();
  return [chalk.bold(line(headers)), ...rows.map(line)].join("\n");
}

function keyValues(entries: [string, unknown][]): string {
  const shown = entries.flatMap(([label, value]) => {
    const text = display(value);
    return text === undefined ? [] : [[label, text] as const];
  });
  const width = Math.max(0, ...shown.map(([label]) => label.length));
  return shown
    .map(([label, text]) => `${chalk.gray(label.padEnd(width))}  ${text}`)
    .join("\n");
}

function customFieldLines(data: unknown): string {
  if (!isRecord(data) || !Object.keys(data).length) {
    return "";
  }
  return `\n\n${chalk.bold("Custom fields")}\n${keyValues(
    Object.entries(data).map(([key, value]) => [humanize(key), value]),
  )}`;
}

function pageFooter(page: Partial<PaginatedResponse<unknown>>, noun: string) {
  const count = page.data?.length ?? 0;
  const total = typeof page.total === "number" ? page.total : count;
  if (!count) {
    return chalk.gray(`No ${noun} found.`);
  }
  if (page.limit === undefined || page.offset === undefined) {
    return chalk.gray(`${total} ${noun}.`);
  }
  const first = page.offset + 1;
  const last = page.offset + count;
  const more = page.hasMore
    ? ` Next page: --offset ${page.offset + page.limit}, or --all for everything.`
    : "";
  return chalk.gray(`Showing ${first}-${last} of ${total} ${noun}.${more}`);
}

function renderPetList(page: PaginatedResponse<Pet>): string {
  if (!page.data.length) {
    return pageFooter(page, "pets");
  }
  const anySample = page.data.some((pet) => pet.is_sample);
  const headers = ["ID", "Name", "Species", "Status", "Public"];
  if (anySample) {
    headers.push("Sample");
  }
  const rows = page.data.map((pet) => {
    const row = [
      pet.id,
      pet.name,
      SPECIES_LABELS.get(pet.species) ?? humanize(pet.species ?? ""),
      pet.status ?? "",
      pet.show_public ? "Yes" : "No",
    ];
    if (anySample) {
      row.push(pet.is_sample ? "Yes" : "");
    }
    return row;
  });
  return `${table(headers, rows)}\n\n${pageFooter(page, "pets")}`;
}

function renderPersonList(page: PaginatedResponse<Person>): string {
  if (!page.data.length) {
    return pageFooter(page, "people");
  }
  const rows = page.data.map((person) => [
    person.id,
    person.name,
    person.email ?? "",
    person.phone ?? "",
    person.status ?? "",
  ]);
  return `${table(["ID", "Name", "Email", "Phone", "Status"], rows)}\n\n${pageFooter(page, "people")}`;
}

function renderPet(pet: Pet): string {
  const age = [
    pet.age_years ? `${pet.age_years} yr` : undefined,
    pet.age_months ? `${pet.age_months} mo` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return `${chalk.bold(pet.name)}\n${keyValues([
    ["ID", pet.id],
    ["Species", SPECIES_LABELS.get(pet.species) ?? pet.species],
    ["Breed", pet.breed],
    ["Color", pet.color],
    ["Age", [humanize(pet.age_category ?? ""), age].filter(Boolean).join(", ")],
    ["Birthday", pet.age_birthday],
    ["Sex", humanize(pet.sex ?? "")],
    ["Size", humanize(pet.size ?? "")],
    ["Status", pet.status],
    ["Health", humanize(pet.health ?? "")],
    ["Public", pet.show_public],
    ["Sample", pet.is_sample ? true : undefined],
    ["Adoption fee", pet.adoption_fee],
    ["Spayed/neutered", pet.spayed],
    ["Good with", pet.good_with?.map(humanize)],
    ["Bad with", pet.bad_with?.map(humanize)],
    ["Temperaments", pet.temperaments?.map(humanize)],
    ["Special needs", pet.special_needs],
    ["Weight", pet.weight],
    ["Intake date", pet.intake_date],
    ["Outcome date", pet.outcome_date],
    ["Hold until", pet.hold_until],
    ["Tags", pet.tags],
    ["Photos", pet.image_urls?.length || undefined],
    ["Description", pet.description],
    ["Updated", pet.updated_at],
  ])}${customFieldLines(pet.custom_field_data)}`;
}

function renderPerson(person: Person): string {
  const application = person.application
    ? `\n\n${chalk.bold("Application")}\n${keyValues([
        ["ID", person.application.id],
        ["Pet IDs", person.application.pet_ids],
        ["Submitted", person.application.submitted_at],
      ])}`
    : "";
  return `${chalk.bold(person.name)}\n${keyValues([
    ["ID", person.id],
    ["Type", humanize(person.type)],
    ["Status", humanize(person.status ?? "")],
    ["Email", person.email],
    ["Phone", person.phone],
    ["Address", person.address],
    ["Capacity", person.capacity],
    ["Skills", person.skills],
    ["Interests", person.interests],
    ["Preferred roles", person.preferred_roles],
    ["Languages", person.languages],
    ["Tags", person.tags],
    ["Updated", person.updated_at],
  ])}${customFieldLines(person.custom_field_data)}${application}`;
}

function renderCustomFields(fields: CustomField[]): string {
  if (!fields.length) {
    return chalk.gray("No custom fields.");
  }
  return table(
    ["Key", "Label", "Type", "Required", "Section"],
    fields.map((field) => [
      field.field_key,
      field.label,
      field.field_type,
      field.required ? "Yes" : "",
      field.section ?? "",
    ]),
  );
}

function renderAdoptionFees(fees: AdoptionFeeEntry[]): string {
  if (!fees.length) {
    return chalk.gray("No adoption fee rules.");
  }
  return table(
    ["Species", "Rule", "Value", "Adjustment"],
    fees.map((fee) => [
      SPECIES_LABELS.get(fee.species) ?? humanize(fee.species),
      humanize(fee.attribute_type),
      humanize(fee.attribute_value),
      String(fee.adjustment),
    ]),
  );
}

function renderContract(contract: ContractResponse): string {
  const updated = contract.updated_at
    ? chalk.gray(` (updated ${contract.updated_at})`)
    : "";
  return `${chalk.bold(`${humanize(contract.type)} contract`)}${updated}\n\n${contract.content}`;
}

export interface DoctorReport {
  apiKey: string;
  apiUrl: string;
  apiVersion?: string;
  cliVersion: string;
  petsVisible: number;
  rateLimit?: { limit: number; remaining: number; reset: number };
  requestId?: string;
  responseTimeMs: number;
  sampleData: boolean;
  sdkVersion: string;
}

function renderDoctor(report: DoctorReport): string {
  const rateLimit = report.rateLimit
    ? `${report.rateLimit.remaining} of ${report.rateLimit.limit} left, resets ${new Date(
        report.rateLimit.reset * 1000,
      ).toLocaleTimeString()}`
    : undefined;
  return `${chalk.green("✓ Your API key works.")}\n\n${keyValues([
    ["API URL", report.apiUrl],
    ["API key", report.apiKey],
    ["API version", report.apiVersion],
    ["Response time", `${report.responseTimeMs} ms`],
    ["Pets visible", report.petsVisible],
    [
      "Sample data",
      report.sampleData
        ? "Active (responses include sample records)"
        : "Not active",
    ],
    ["Rate limit (pets list)", rateLimit],
    ["Request ID", report.requestId],
    ["CLI", report.cliVersion],
    ["SDK", report.sdkVersion],
  ])}`;
}

function renderHuman(view: View, value: unknown): string {
  switch (view) {
    case "pet-list":
      return renderPetList(value as PaginatedResponse<Pet>);
    case "person-list":
      return renderPersonList(value as PaginatedResponse<Person>);
    case "pet":
      return renderPet(value as Pet);
    case "person":
      return renderPerson(value as Person);
    case "custom-fields":
      return renderCustomFields(value as CustomField[]);
    case "adoption-fees":
      return renderAdoptionFees(value as AdoptionFeeEntry[]);
    case "contract":
      return renderContract(value as ContractResponse);
    case "doctor":
      return renderDoctor(value as DoctorReport);
  }
}

export function writeResult(
  stdout: Writable,
  mode: OutputMode,
  result: Rendered,
): void {
  if (mode.json) {
    stdout.write(
      `${JSON.stringify(result.value, null, mode.compact ? 0 : 2)}\n`,
    );
    return;
  }
  stdout.write(`${renderHuman(result.view, result.value)}\n`);
}
