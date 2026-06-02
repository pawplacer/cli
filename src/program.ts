import { readFile } from "node:fs/promises";
import process from "node:process";

import packageJson from "../package.json";
import {
  confirm,
  input,
  number,
  password,
  select,
} from "@inquirer/prompts";
import chalk from "chalk";
import { Command } from "commander";
import {
  PawPlacerApiError,
  PawPlacerClient,
  PawPlacerResponseValidationError,
  type ContractType,
  type CreateOptions,
  type PawPlacerConfig,
  type PersonListParams,
  type PersonType,
  type PetListParams,
} from "pawplacer-sdk";

type Writable = Pick<NodeJS.WriteStream, "write">;

export interface ProgramDeps {
  clientFactory?: (config: PawPlacerConfig) => PawPlacerClientLike;
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  prompts?: PromptAdapter;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  readStdin?: () => Promise<string>;
  stderr?: Writable;
  stdout?: Writable;
}

export interface PromptAdapter {
  confirm: typeof confirm;
  input: typeof input;
  number: typeof number;
  password: typeof password;
  select: typeof select;
}

export interface PawPlacerClientLike {
  adoptionFees: {
    get: () => Promise<unknown>;
  };
  contracts: {
    get: (type: ContractType) => Promise<unknown>;
  };
  people: {
    create: (payload: unknown, options?: CreateOptions) => Promise<unknown>;
    get: (
      id: string,
      type: PersonType,
      options?: { forceRefresh?: boolean },
    ) => Promise<unknown>;
    getCustomFields: (type: PersonType) => Promise<unknown>;
    list: (params: PersonListParams) => Promise<unknown>;
  };
  pets: {
    create: (payload: unknown, options?: CreateOptions) => Promise<unknown>;
    findMany: (params?: PetListParams, limit?: number) => Promise<unknown>;
    get: (id: string, options?: { forceRefresh?: boolean }) => Promise<unknown>;
    getByStatus: (status: string) => Promise<unknown>;
    getCustomFields: () => Promise<unknown>;
    list: (params?: PetListParams) => Promise<unknown>;
    search: (query: string) => Promise<unknown>;
  };
}

interface RootOptions {
  apiKey?: string;
  apiUrl?: string;
  cache?: boolean;
  compact?: boolean;
  timeout?: string;
}

interface ListOptions {
  limit?: string;
  offset?: string;
  search?: string;
  species?: string;
  status?: string;
  updatedSince?: string;
}

interface PeopleListOptions extends Omit<ListOptions, "species"> {
  type?: string;
}

interface PayloadOptions {
  file?: string;
  json?: string;
  prompt?: boolean;
  stdin?: boolean;
}

interface CreateCommandOptions extends PayloadOptions {
  autoIdempotencyKey?: boolean;
  idempotencyKey?: string;
  retry?: boolean;
}

interface TypeOption {
  type?: string;
}

interface ForceRefreshOption {
  forceRefresh?: boolean;
}

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const PERSON_TYPES = ["adopter", "foster", "surrender", "volunteer"] as const;
const CONTRACT_TYPES = ["adopter", "foster", "surrender", "volunteer"] as const;

function parseIntegerOption(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed.toString() !== value) {
    throw new CliUsageError(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requirePersonType(value: string | undefined): PersonType {
  if (PERSON_TYPES.includes(value as PersonType)) {
    return value as PersonType;
  }
  throw new CliUsageError(
    'type is required and must be "adopter", "foster", "surrender", or "volunteer"',
  );
}

function requireContractType(value: string | undefined): ContractType {
  if (CONTRACT_TYPES.includes(value as ContractType)) {
    return value as ContractType;
  }
  throw new CliUsageError(
    'type is required and must be "adopter", "foster", "surrender", or "volunteer"',
  );
}

function buildPetListParams(options: ListOptions): PetListParams {
  return {
    limit: parseIntegerOption(options.limit, "limit"),
    offset: parseIntegerOption(options.offset, "offset"),
    search: optionalString(options.search),
    species: optionalString(options.species),
    status: optionalString(options.status),
    updated_since: optionalString(options.updatedSince),
  };
}

function buildPeopleListParams(options: PeopleListOptions): PersonListParams {
  return {
    type: requirePersonType(options.type),
    limit: parseIntegerOption(options.limit, "limit"),
    offset: parseIntegerOption(options.offset, "offset"),
    search: optionalString(options.search),
    status: optionalString(options.status),
    updated_since: optionalString(options.updatedSince),
  };
}

function buildCreateOptions(options: CreateCommandOptions): CreateOptions {
  return {
    idempotencyKey:
      options.autoIdempotencyKey === false
        ? false
        : optionalString(options.idempotencyKey),
    retry: options.retry,
  };
}

function defaultPrompts(): PromptAdapter {
  return {
    confirm,
    input,
    number,
    password,
    select,
  };
}

async function defaultReadStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonObject(source: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new CliUsageError(`${label} must contain valid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliUsageError(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function readPayload(
  options: PayloadOptions,
  deps: Required<Pick<ProgramDeps, "readFile" | "readStdin" | "prompts">>,
  promptBuilder?: (
    prompts: PromptAdapter,
  ) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const sources = [
    options.file !== undefined,
    options.json !== undefined,
    options.prompt === true,
    options.stdin === true,
  ].filter(Boolean).length;

  if (sources !== 1) {
    throw new CliUsageError(
      "Provide exactly one of --file, --json, --stdin, or --prompt",
    );
  }

  if (options.json !== undefined) {
    return parseJsonObject(options.json, "--json");
  }

  if (options.prompt) {
    if (!promptBuilder) {
      throw new CliUsageError("This command does not support --prompt");
    }
    return promptBuilder(deps.prompts);
  }

  if (options.stdin) {
    return parseJsonObject(await deps.readStdin(), "stdin");
  }

  const file = options.file;
  if (!file) {
    throw new CliUsageError("--file requires a path");
  }
  if (file === "-") {
    return parseJsonObject(await deps.readStdin(), "stdin");
  }
  return parseJsonObject(await deps.readFile(file, "utf8"), file);
}

async function promptForPetPayload(
  prompts: PromptAdapter,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    name: await prompts.input({ message: "Pet name", required: true }),
    species: await prompts.select({
      message: "Species",
      choices: [
        { name: "Dog", value: "dog" },
        { name: "Cat", value: "cat" },
        { name: "Rabbit", value: "rabbit" },
      ],
    }),
    age_category: await prompts.select({
      message: "Age category",
      choices: [
        { name: "Youngest", value: "youngest" },
        { name: "Young", value: "young" },
        { name: "Adult", value: "adult" },
        { name: "Senior", value: "senior" },
      ],
    }),
    sex: await prompts.select({
      message: "Sex",
      choices: [
        { name: "Male", value: "male" },
        { name: "Female", value: "female" },
        { name: "Unknown", value: "unknown" },
      ],
    }),
    size: await prompts.select({
      message: "Size",
      choices: [
        { name: "Extra small", value: "xSmall" },
        { name: "Small", value: "small" },
        { name: "Medium", value: "medium" },
        { name: "Large", value: "large" },
        { name: "Extra large", value: "xLarge" },
      ],
    }),
    status: await prompts.input({
      message: "Status",
      default: "available",
      required: true,
    }),
    health: await prompts.select({
      message: "Health",
      choices: [
        { name: "Unknown", value: "unknown" },
        { name: "Poor", value: "poor" },
        { name: "Good", value: "good" },
        { name: "Great", value: "great" },
      ],
    }),
  };

  const breed = await prompts.input({
    message: "Breed names, comma-separated",
    default: "",
  });
  if (breed.trim()) {
    payload.breed = breed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  const adoptionFee = await prompts.number({
    message: "Adoption fee",
    default: undefined,
  });
  if (typeof adoptionFee === "number" && Number.isFinite(adoptionFee)) {
    payload.adoption_fee = adoptionFee;
  }

  const description = await prompts.input({
    message: "Description",
    default: "",
  });
  if (description.trim()) {
    payload.description = description.trim();
  }

  payload.show_public = await prompts.confirm({
    message: "Show publicly?",
    default: true,
  });

  return payload;
}

async function promptForPersonPayload(
  prompts: PromptAdapter,
): Promise<Record<string, unknown>> {
  const type = await prompts.select({
    message: "Person type",
    choices: PERSON_TYPES.map((value) => ({ name: value, value })),
  });
  const payload: Record<string, unknown> = {
    type,
    name: await prompts.input({ message: "Name", required: true }),
  };

  for (const field of ["email", "phone", "address"] as const) {
    const value = await prompts.input({
      message: field.replace("_", " "),
      default: "",
    });
    if (value.trim()) {
      payload[field] = value.trim();
    }
  }

  const status = await prompts.input({
    message: "Status",
    default: type === "adopter" ? "active" : "",
  });
  if (status.trim()) {
    payload.status = status.trim();
  }

  if (type === "foster") {
    const capacity = await prompts.number({
      message: "Foster capacity",
      default: undefined,
    });
    if (typeof capacity === "number" && Number.isFinite(capacity)) {
      payload.capacity = capacity;
    }
  }

  return payload;
}

function writeJson(stdout: Writable, value: unknown, compact: boolean): void {
  stdout.write(`${JSON.stringify(value, null, compact ? 0 : 2)}\n`);
}

async function createClient(
  command: Command,
  deps: ProgramDeps,
): Promise<PawPlacerClientLike> {
  const options = command.optsWithGlobals<RootOptions>();
  const timeout = parseIntegerOption(options.timeout, "timeout");
  let apiKey = optionalString(options.apiKey ?? deps.env?.PAWPLACER_API_KEY);
  if (!apiKey && deps.interactive && deps.prompts) {
    apiKey = optionalString(
      await deps.prompts.password({
        message: "PawPlacer API key",
        mask: "*",
      }),
    );
  }
  if (!apiKey) {
    throw new CliUsageError(
      "API key is required. Set PAWPLACER_API_KEY, pass --api-key, or run in an interactive terminal.",
    );
  }
  const apiUrl = optionalString(options.apiUrl);
  const clientFactory =
    deps.clientFactory ??
    ((config): PawPlacerClientLike =>
      new PawPlacerClient(config) as unknown as PawPlacerClientLike);

  return clientFactory({
    apiKey,
    apiUrl,
    timeout,
    cache: { enabled: options.cache !== false },
  });
}

function action(
  deps: Required<
    Pick<ProgramDeps, "prompts" | "readFile" | "readStdin" | "stdout">
  > &
    ProgramDeps,
  handler: (command: Command, client: PawPlacerClientLike) => Promise<unknown>,
) {
  return async (...args: unknown[]) => {
    const command = args[args.length - 1];
    if (!(command instanceof Command)) {
      throw new CliUsageError("Unable to resolve command context");
    }

    const client = await createClient(command, deps);
    const result = await handler(command, client);
    writeJson(
      deps.stdout,
      result,
      command.optsWithGlobals<RootOptions>().compact === true,
    );
  };
}

function addListOptions(command: Command, includeSpecies: boolean): Command {
  command
    .option("--limit <number>", "maximum records to return")
    .option("--offset <number>", "records to skip")
    .option("--status <status>", "filter by status")
    .option("--search <query>", "filter by search query")
    .option("--updated-since <iso>", "filter by updated timestamp");

  if (includeSpecies) {
    command.option("--species <species>", "filter by species");
  }

  return command;
}

function addPayloadOptions(command: Command): Command {
  return command
    .option("--file <path>", "read JSON payload from a file; use - for stdin")
    .option("--json <json>", "read JSON payload from an inline string")
    .option("--prompt", "build the payload interactively")
    .option("--stdin", "read JSON payload from stdin")
    .option("--idempotency-key <key>", "stable idempotency key for safe retries")
    .option("--no-auto-idempotency-key", "disable automatic idempotency key")
    .option("--retry", "enable POST retry when an idempotency key is present");
}

export function formatError(error: unknown): string {
  if (error instanceof PawPlacerApiError) {
    const status = error.status ? ` ${error.status}` : "";
    const requestId =
      error.requestId && error.requestId !== "unknown"
        ? `\nrequest_id: ${error.requestId}`
        : "";
    return `${chalk.red(`API error${status}`)}: ${chalk.yellow(
      `[${error.code}]`,
    )} ${error.message}${requestId}`;
  }

  if (error instanceof PawPlacerResponseValidationError) {
    return `${chalk.red("Unexpected API response")}: ${error.message}`;
  }

  if (error instanceof Error) {
    return chalk.red(error.message);
  }

  return String(error);
}

export function createProgram(deps: ProgramDeps = {}): Command {
  const fullDeps = {
    env: deps.env ?? process.env,
    interactive: deps.interactive ?? process.stdin.isTTY,
    prompts: deps.prompts ?? defaultPrompts(),
    readFile: deps.readFile ?? readFile,
    readStdin: deps.readStdin ?? defaultReadStdin,
    stderr: deps.stderr ?? process.stderr,
    stdout: deps.stdout ?? process.stdout,
    clientFactory: deps.clientFactory,
  };

  const program = new Command();
  program
    .name("pawplacer")
    .description("Command-line interface for the PawPlacer API")
    .version(packageJson.version)
    .option("--api-key <key>", "PawPlacer API key; defaults to PAWPLACER_API_KEY")
    .option("--api-url <url>", "PawPlacer API URL")
    .option("--timeout <ms>", "request timeout in milliseconds")
    .option("--no-cache", "disable SDK in-memory GET cache")
    .option("--compact", "print compact JSON");

  const pets = program.command("pets").description("Work with pets");
  addListOptions(pets.command("list").description("List pets"), true).action(
    action(fullDeps, async (command, client) =>
      client.pets.list(buildPetListParams(command.opts<ListOptions>())),
    ),
  );
  pets
    .command("get")
    .description("Fetch a pet by ID")
    .argument("<id>", "pet ID")
    .option("--force-refresh", "bypass cached value")
    .action(
      action(fullDeps, async (command, client) =>
        client.pets.get(command.args[0]!, {
          forceRefresh: command.opts<ForceRefreshOption>().forceRefresh,
        }),
      ),
    );
  pets
    .command("search")
    .description("Search pets by name or description")
    .argument("<query>", "search query")
    .action(
      action(fullDeps, async (command, client) =>
        client.pets.search(command.args[0]!),
      ),
    );
  pets
    .command("status")
    .description("List pets by status")
    .argument("<status>", "pet status")
    .action(
      action(fullDeps, async (command, client) =>
        client.pets.getByStatus(command.args[0]!),
      ),
    );
  addPayloadOptions(pets.command("create").description("Create a pet")).action(
    action(fullDeps, async (command, client) => {
      const options = command.opts<CreateCommandOptions>();
      return client.pets.create(
        await readPayload(options, fullDeps, promptForPetPayload),
        buildCreateOptions(options),
      );
    }),
  );
  pets
    .command("custom-fields")
    .description("Fetch pet custom field definitions")
    .action(action(fullDeps, async (_command, client) => client.pets.getCustomFields()));

  const people = program.command("people").description("Work with people");
  addListOptions(people.command("list").description("List people"), false)
    .requiredOption("--type <type>", "adopter, foster, surrender, or volunteer")
    .action(
      action(fullDeps, async (command, client) =>
        client.people.list(buildPeopleListParams(command.opts<PeopleListOptions>())),
      ),
    );
  people
    .command("get")
    .description("Fetch a person by ID")
    .argument("<id>", "person ID")
    .requiredOption("--type <type>", "adopter, foster, surrender, or volunteer")
    .option("--force-refresh", "bypass cached value")
    .action(
      action(fullDeps, async (command, client) => {
        const options = command.opts<TypeOption & ForceRefreshOption>();
        return client.people.get(command.args[0]!, requirePersonType(options.type), {
          forceRefresh: options.forceRefresh,
        });
      }),
    );
  addPayloadOptions(people.command("create").description("Create a person")).action(
    action(fullDeps, async (command, client) => {
      const options = command.opts<CreateCommandOptions>();
      return client.people.create(
        await readPayload(options, fullDeps, promptForPersonPayload),
        buildCreateOptions(options),
      );
    }),
  );
  people
    .command("custom-fields")
    .description("Fetch people custom field definitions")
    .requiredOption("--type <type>", "adopter, foster, surrender, or volunteer")
    .action(
      action(fullDeps, async (command, client) =>
        client.people.getCustomFields(requirePersonType(command.opts<TypeOption>().type)),
      ),
    );

  program
    .command("adoption-fees")
    .description("Fetch adoption fee rules")
    .action(action(fullDeps, async (_command, client) => client.adoptionFees.get()));

  program
    .command("contracts")
    .description("Fetch contract markdown")
    .requiredOption("--type <type>", "adopter, foster, surrender, or volunteer")
    .action(
      action(fullDeps, async (command, client) =>
        client.contracts.get(requireContractType(command.opts<TypeOption>().type)),
      ),
    );

  program
    .command("guide")
    .description("Start an interactive guide for common read-only tasks")
    .action(
      action(fullDeps, async (_command, client) => {
        fullDeps.stderr.write(
          `${chalk.bold("PawPlacer guide")}\n${chalk.gray(
            "Choose a task and answer a few prompts. Results are printed as JSON.",
          )}\n`,
        );
        const task = await fullDeps.prompts.select({
          message: "What do you want to do?",
          choices: [
            { name: "List available pets", value: "pets:list" },
            { name: "Search pets", value: "pets:search" },
            { name: "Get a pet by ID", value: "pets:get" },
            { name: "List people", value: "people:list" },
            { name: "Get a person by ID", value: "people:get" },
            { name: "View adoption fees", value: "adoption-fees" },
            { name: "View contract terms", value: "contracts" },
          ],
        });

        if (task === "pets:list") {
          const species = await fullDeps.prompts.input({
            message: "Species filter",
            default: "",
          });
          return client.pets.list({
            status: "available",
            species: optionalString(species),
            limit: 20,
          });
        }
        if (task === "pets:search") {
          return client.pets.search(
            await fullDeps.prompts.input({
              message: "Search query",
              required: true,
            }),
          );
        }
        if (task === "pets:get") {
          return client.pets.get(
            await fullDeps.prompts.input({
              message: "Pet ID",
              required: true,
            }),
          );
        }
        if (task === "people:list") {
          const type = await fullDeps.prompts.select({
            message: "Person type",
            choices: PERSON_TYPES.map((value) => ({ name: value, value })),
          });
          return client.people.list({ type, limit: 20 });
        }
        if (task === "people:get") {
          const type = await fullDeps.prompts.select({
            message: "Person type",
            choices: PERSON_TYPES.map((value) => ({ name: value, value })),
          });
          const id = await fullDeps.prompts.input({
            message: "Person ID",
            required: true,
          });
          return client.people.get(id, type);
        }
        if (task === "adoption-fees") {
          return client.adoptionFees.get();
        }

        const type = await fullDeps.prompts.select({
          message: "Contract type",
          choices: CONTRACT_TYPES.map((value) => ({ name: value, value })),
        });
        return client.contracts.get(type);
      }),
    );

  return program;
}
