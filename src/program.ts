import { readFile } from "node:fs/promises";
import process from "node:process";
import { format } from "node:util";

import chalk from "chalk";
import { Command, Option } from "commander";
import {
  type ContractType,
  PawPlacerClient,
  type PersonListParams,
  type PersonStatus,
  type PersonType,
  type PetListParams,
  type PetSpecies,
  SDK_VERSION,
  type WriteOptions,
} from "pawplacer-sdk";

import packageJson from "../package.json";
import {
  CONTRACT_TYPES,
  PERSON_STATUSES,
  PERSON_TYPES,
  PET_SPECIES,
} from "./constants";
import { CliUsageError } from "./errors";
import { runGuide } from "./guide";
import { assertNoRemovedUsage } from "./migration";
import {
  type DoctorReport,
  type OutputMode,
  type Rendered,
  type Writable,
  writeResult,
} from "./output";
import { type PayloadOptions, readPayload } from "./payload";
import { defaultPrompts, type PromptAdapter } from "./prompts/adapter";
import { promptForPersonCreate } from "./prompts/person";
import { promptForPetCreate, promptForPetUpdate } from "./prompts/pet";

export const DEFAULT_API_URL = "https://pawplacer.com";
const MAX_PAGE_SIZE = 100;
const SAMPLE_DATA_NOTICE =
  "Note: this workspace still has sample data, so results include sample records. Keep or clear it in Settings > Danger Zone before syncing anything live.";

export interface ProgramDeps {
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  prompts?: PromptAdapter;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  readStdin?: () => Promise<string>;
  stderr?: Writable;
  stdout?: Writable;
  stdoutIsTTY?: boolean;
}

type ResolvedDeps = Required<ProgramDeps>;

export interface GlobalOptions {
  apiKey?: string;
  apiUrl?: string;
  compact?: boolean;
  debug?: boolean;
  json?: boolean;
  quiet?: boolean;
  timeout?: string;
}

interface ListOptions {
  all?: boolean;
  limit?: string;
  offset?: string;
  search?: string;
  since?: string;
  species?: string;
  status?: string;
  type?: string;
}

interface WriteCommandOptions extends PayloadOptions {
  idempotencyKey?: string | false;
}

export interface ActionContext {
  client: PawPlacerClient;
  command: Command;
  deps: ResolvedDeps;
  globals: GlobalOptions;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseInteger(
  value: string | undefined,
  name: string,
  { max, min }: { max?: number; min: number },
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (
    !Number.isInteger(parsed) ||
    parsed < min ||
    (max !== undefined && parsed > max)
  ) {
    const range = max === undefined ? `${min} or more` : `${min}-${max}`;
    throw new CliUsageError(`${name} must be a whole number, ${range}.`);
  }
  return parsed;
}

function parseSince(value: string | undefined): string | undefined {
  const since = optionalString(value);
  if (since && Number.isNaN(Date.parse(since))) {
    throw new CliUsageError(
      "--since must be an ISO date or timestamp, like 2026-11-01 or 2026-11-01T12:00:00Z.",
    );
  }
  return since;
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T {
  if (value !== undefined && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new CliUsageError(`${name} must be one of: ${allowed.join(", ")}.`);
}

function optionalOneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T | undefined {
  return optionalString(value) === undefined
    ? undefined
    : oneOf(value?.trim(), allowed, name);
}

export function requirePersonType(value: string | undefined): PersonType {
  return oneOf(value, PERSON_TYPES, "--type");
}

function petListParams(options: ListOptions): PetListParams {
  return {
    limit: parseInteger(options.limit, "--limit", {
      min: 1,
      max: MAX_PAGE_SIZE,
    }),
    offset: parseInteger(options.offset, "--offset", { min: 0 }),
    search: optionalString(options.search),
    species: optionalOneOf<PetSpecies>(
      options.species,
      PET_SPECIES.map((species) => species.value),
      "--species",
    ),
    status: optionalString(options.status),
    updated_since: parseSince(options.since),
  };
}

function personListParams(options: ListOptions): PersonListParams {
  return {
    type: requirePersonType(options.type),
    limit: parseInteger(options.limit, "--limit", {
      min: 1,
      max: MAX_PAGE_SIZE,
    }),
    offset: parseInteger(options.offset, "--offset", { min: 0 }),
    search: optionalString(options.search),
    status: optionalOneOf<PersonStatus>(
      options.status,
      PERSON_STATUSES,
      "--status",
    ),
    updated_since: parseSince(options.since),
  };
}

function writeOptions(options: WriteCommandOptions): WriteOptions {
  return {
    idempotencyKey:
      options.idempotencyKey === false
        ? false
        : optionalString(options.idempotencyKey),
  };
}

async function collectAll<T>(items: AsyncIterable<T>) {
  const data: T[] = [];
  for await (const item of items) {
    data.push(item);
  }
  return { data, total: data.length };
}

function withoutOffset<T extends { offset?: number }>(
  params: T,
): Omit<T, "offset"> {
  if (params.offset !== undefined) {
    throw new CliUsageError(`--all can't be combined with --offset.`);
  }
  const { offset: _offset, ...rest } = params;
  return rest;
}

async function defaultReadStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function keyPreview(apiKey: string): string {
  const [identifier] = apiKey.split(".");
  return identifier && identifier !== apiKey ? `${identifier}.***` : "***";
}

export function resolveApiUrl(
  globals: GlobalOptions,
  env: NodeJS.ProcessEnv,
): string {
  return (
    optionalString(globals.apiUrl) ??
    optionalString(env.PAWPLACER_API_URL) ??
    DEFAULT_API_URL
  );
}

async function resolveApiKey(
  globals: GlobalOptions,
  deps: ResolvedDeps,
): Promise<string> {
  const apiKey =
    optionalString(globals.apiKey) ??
    optionalString(deps.env.PAWPLACER_API_KEY);
  if (apiKey) {
    return apiKey;
  }
  if (deps.interactive) {
    const prompted = optionalString(
      await deps.prompts.password({ message: "PawPlacer API key", mask: "*" }),
    );
    if (prompted) {
      return prompted;
    }
  }
  throw new CliUsageError(
    "No API key. Set PAWPLACER_API_KEY or pass --api-key. Create a key in PawPlacer under Settings > SDK/API.",
  );
}

async function createClient(
  globals: GlobalOptions,
  deps: ResolvedDeps,
): Promise<{ apiKey: string; client: PawPlacerClient }> {
  const apiKey = await resolveApiKey(globals, deps);
  if (globals.debug) {
    console.debug = (...args: unknown[]) => {
      deps.stderr.write(`${chalk.gray(format(...args))}\n`);
    };
  }
  const client = new PawPlacerClient({
    apiKey,
    apiUrl: resolveApiUrl(globals, deps.env),
    timeout: parseInteger(globals.timeout, "--timeout", { min: 1 }),
    cache: { enabled: false },
    debug: globals.debug === true,
  });
  return { apiKey, client };
}

function outputMode(globals: GlobalOptions, deps: ResolvedDeps): OutputMode {
  return {
    compact: globals.compact === true,
    json:
      globals.json === true || globals.compact === true || !deps.stdoutIsTTY,
  };
}

function action(
  deps: ResolvedDeps,
  handler: (context: ActionContext & { apiKey: string }) => Promise<Rendered>,
) {
  return async (...args: unknown[]) => {
    const command = args.at(-1);
    if (!(command instanceof Command)) {
      throw new CliUsageError("Unable to resolve command context.");
    }
    const globals = command.optsWithGlobals<GlobalOptions>();
    const { apiKey, client } = await createClient(globals, deps);
    const result = await handler({ apiKey, client, command, deps, globals });
    writeResult(deps.stdout, outputMode(globals, deps), result);
    if (!globals.quiet && client.lastResponseMeta.sampleData) {
      deps.stderr.write(`${chalk.yellow(SAMPLE_DATA_NOTICE)}\n`);
    }
  };
}

function addListOptions(command: Command): Command {
  return command
    .option("--status <status>", "only records with this status")
    .option("--search <query>", "only records matching this text")
    .option("--since <date>", "only records updated since an ISO date or time")
    .option("--limit <n>", `records per page, 1-${MAX_PAGE_SIZE} (default 20)`)
    .option("--offset <n>", "records to skip")
    .option("--all", "fetch every page");
}

function addWriteOptions(command: Command): Command {
  return command
    .option("--data <json>", "the JSON payload, inline")
    .option("--file <path>", "read the JSON payload from a file; - for stdin")
    .option("--prompt", "answer prompts to build the payload")
    .option(
      "--idempotency-key <key>",
      "stable key so a retried or repeated run writes only once",
    )
    .option("--no-idempotency-key", "send no idempotency key")
    .addHelpText(
      "after",
      "\nWith no payload flag, the CLI prompts in a terminal and reads JSON from stdin when piped.",
    );
}

const typeOption = () =>
  new Option("--type <type>", "person type")
    .choices(PERSON_TYPES)
    .makeOptionMandatory();

async function doctor({
  apiKey,
  client,
  deps,
  globals,
}: ActionContext & { apiKey: string }): Promise<Rendered> {
  const started = Date.now();
  const page = await client.pets.list({ limit: 1 });
  const meta = client.lastResponseMeta;
  const report: DoctorReport = {
    apiKey: keyPreview(apiKey),
    apiUrl: resolveApiUrl(globals, deps.env),
    apiVersion: meta.apiVersion,
    cliVersion: packageJson.version,
    petsVisible: page.total,
    rateLimit: meta.rateLimit,
    requestId: meta.requestId,
    responseTimeMs: Date.now() - started,
    sampleData: meta.sampleData === true,
    sdkVersion: SDK_VERSION,
  };
  return { view: "doctor", value: report };
}

export function createProgram(deps: ProgramDeps = {}): Command {
  const resolved: ResolvedDeps = {
    env: deps.env ?? process.env,
    interactive: deps.interactive ?? process.stdin.isTTY === true,
    prompts: deps.prompts ?? defaultPrompts(),
    readFile: deps.readFile ?? readFile,
    readStdin: deps.readStdin ?? defaultReadStdin,
    stderr: deps.stderr ?? process.stderr,
    stdout: deps.stdout ?? process.stdout,
    stdoutIsTTY: deps.stdoutIsTTY ?? process.stdout.isTTY === true,
  };
  const payloadDeps = {
    interactive: resolved.interactive,
    readFile: resolved.readFile,
    readStdin: resolved.readStdin,
  };

  const program = new Command();
  program
    .name("pawplacer")
    .description("Work with your PawPlacer pets, people, fees, and contracts.")
    .version(packageJson.version)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => resolved.stdout.write(text),
      writeErr: (text) => resolved.stderr.write(text),
      outputError: (text, write) => write(chalk.red(text)),
    })
    .showHelpAfterError("(run with --help for usage)")
    .option("--api-key <key>", "API key (default: PAWPLACER_API_KEY)")
    .option(
      "--api-url <url>",
      `API URL (default: PAWPLACER_API_URL or ${DEFAULT_API_URL})`,
    )
    .option("--timeout <ms>", "per-request timeout in milliseconds")
    .option("--json", "print JSON (the default when output is piped)")
    .option("--compact", "print compact JSON")
    .option("--quiet", "hide notices such as the sample-data reminder")
    .option("--debug", "log each request and show stack traces");

  const pets = program.command("pets").description("Work with pets");
  addListOptions(
    pets
      .command("list")
      .description("List pets")
      .option("--species <species>", "only this species"),
  ).action(
    action(resolved, async ({ client, command }) => {
      const options = command.opts<ListOptions>();
      const params = petListParams(options);
      return {
        view: "pet-list",
        value: options.all
          ? await collectAll(client.pets.listAll(withoutOffset(params)))
          : await client.pets.list(params),
      };
    }),
  );
  pets
    .command("get")
    .description("Show one pet")
    .argument("<id>", "pet UUID")
    .action(
      action(resolved, async ({ client, command }) => ({
        view: "pet",
        value: await client.pets.get(command.args[0] ?? ""),
      })),
    );
  addWriteOptions(pets.command("create").description("Create a pet")).action(
    action(resolved, async ({ client, command }) => {
      const options = command.opts<WriteCommandOptions>();
      const payload = await readPayload(options, payloadDeps, () =>
        promptForPetCreate(resolved.prompts, () =>
          client.pets.getCustomFields(),
        ),
      );
      return {
        view: "pet",
        value: await client.pets.create(
          payload as never,
          writeOptions(options),
        ),
      };
    }),
  );
  addWriteOptions(
    pets
      .command("update")
      .description("Update a pet; empty strings and [] clear fields")
      .argument("<id-or-custom-id>", "pet UUID or your custom_id"),
  ).action(
    action(resolved, async ({ client, command }) => {
      const options = command.opts<WriteCommandOptions>();
      const payload = await readPayload(options, payloadDeps, () =>
        promptForPetUpdate(resolved.prompts, () =>
          client.pets.getCustomFields(),
        ),
      );
      return {
        view: "pet",
        value: await client.pets.update(
          command.args[0] ?? "",
          payload as never,
          writeOptions(options),
        ),
      };
    }),
  );
  pets
    .command("custom-fields")
    .description("List your pet custom fields")
    .action(
      action(resolved, async ({ client }) => ({
        view: "custom-fields",
        value: await client.pets.getCustomFields(),
      })),
    );

  const people = program.command("people").description("Work with people");
  addListOptions(
    people.command("list").description("List people").addOption(typeOption()),
  ).action(
    action(resolved, async ({ client, command }) => {
      const options = command.opts<ListOptions>();
      const params = personListParams(options);
      return {
        view: "person-list",
        value: options.all
          ? await collectAll(client.people.listAll(withoutOffset(params)))
          : await client.people.list(params),
      };
    }),
  );
  people
    .command("get")
    .description("Show one person")
    .argument("<id>", "person UUID")
    .addOption(typeOption())
    .action(
      action(resolved, async ({ client, command }) => ({
        view: "person",
        value: await client.people.get(
          command.args[0] ?? "",
          requirePersonType(command.opts<ListOptions>().type),
        ),
      })),
    );
  addWriteOptions(
    people
      .command("create")
      .description("Create an adopter, foster, surrender, or volunteer"),
  ).action(
    action(resolved, async ({ client, command }) => {
      const options = command.opts<WriteCommandOptions>();
      const payload = await readPayload(options, payloadDeps, () =>
        promptForPersonCreate(resolved.prompts, {
          loadContract: (type) => client.contracts.get(type),
          loadCustomFields: (type) => client.people.getCustomFields(type),
          stderr: resolved.stderr,
        }),
      );
      return {
        view: "person",
        value: await client.people.create(
          payload as never,
          writeOptions(options),
        ),
      };
    }),
  );
  people
    .command("custom-fields")
    .description("List the custom fields for a person type")
    .addOption(typeOption())
    .action(
      action(resolved, async ({ client, command }) => ({
        view: "custom-fields",
        value: await client.people.getCustomFields(
          requirePersonType(command.opts<ListOptions>().type),
        ),
      })),
    );

  program
    .command("adoption-fees")
    .description("Show your adoption fee rules")
    .action(
      action(resolved, async ({ client }) => ({
        view: "adoption-fees",
        value: await client.adoptionFees.get(),
      })),
    );

  program
    .command("contracts")
    .description("Show a contract's terms")
    .addOption(
      new Option("--type <type>", "contract type")
        .choices(CONTRACT_TYPES)
        .makeOptionMandatory(),
    )
    .action(
      action(resolved, async ({ client, command }) => ({
        view: "contract",
        value: await client.contracts.get(
          command.opts<{ type: ContractType }>().type,
        ),
      })),
    );

  program
    .command("doctor")
    .description("Check your API key, connection, and sample-data state")
    .action(action(resolved, doctor));

  program
    .command("guide")
    .description("Pick a task from a menu and answer a few prompts")
    .action(
      action(resolved, async (context) => {
        if (!resolved.interactive) {
          throw new CliUsageError("guide needs an interactive terminal.");
        }
        return runGuide(context, doctor);
      }),
    );

  return program;
}

export async function runProgram(
  argv: string[],
  deps: ProgramDeps = {},
): Promise<Command> {
  assertNoRemovedUsage(argv.slice(2));
  const program = createProgram(deps);
  await program.parseAsync(argv);
  return program;
}
