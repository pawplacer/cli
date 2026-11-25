import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import chalk from "chalk";
import type { Person, Pet } from "pawplacer-sdk";
import { afterAll, beforeAll, beforeEach } from "vitest";

import type { PromptAdapter } from "../src/prompts/adapter";
import { runCli } from "../src/run";

chalk.level = 0;

export const API_KEY = "ppk_live_test.secret0000000000000000000001";

export interface RecordedRequest {
  body: unknown;
  headers: IncomingMessage["headers"];
  method: string;
  path: string;
  query: URLSearchParams;
}

export interface StubResponse {
  body?: unknown;
  headers?: Record<string, string>;
  status?: number;
}

type Handler = (request: RecordedRequest) => StubResponse;

export function useStubServer() {
  let server: Server;
  const stub = {
    url: "",
    requests: [] as RecordedRequest[],
    handler: (() => ({
      status: 500,
      body: { error: "No handler" },
    })) as Handler,
  };

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const raw = Buffer.concat(chunks).toString();
      const url = new URL(req.url ?? "/", "http://localhost");
      const recorded: RecordedRequest = {
        body: raw ? JSON.parse(raw) : undefined,
        headers: req.headers,
        method: req.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
      };
      stub.requests.push(recorded);
      const { status = 200, body, headers = {} } = stub.handler(recorded);
      res.writeHead(status, {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      });
      res.end(body !== undefined ? JSON.stringify(body) : undefined);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    stub.requests = [];
    stub.handler = () => ({ status: 500, body: { error: "No handler" } });
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  return stub;
}

export const PET_ID = "550e8400-e29b-41d4-a716-446655440001";

export function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: PET_ID,
    name: "Max",
    species: "dog",
    age_category: "young",
    sex: "male",
    size: "medium",
    status: "Available",
    health: "good",
    breed: ["Labrador Retriever"],
    color: ["Black"],
    age_years: "2",
    age_months: null,
    age_birthday: null,
    description: "Friendly dog",
    spayed: true,
    adoption_fee: "250",
    global_adoption_fee: null,
    microchip_id: null,
    good_with: ["kids"],
    bad_with: [],
    temperaments: ["playful"],
    image_urls: [],
    image_url: null,
    coat_length: null,
    custom_field_data: {},
    custom_id: null,
    intake_date: null,
    outcome_date: null,
    primary_veterinarian: null,
    show_public: true,
    special_needs: [],
    tags: [],
    status_change_notes: null,
    weight: null,
    adopted_by: null,
    adopted_on: null,
    hold_until: null,
    is_sample: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-1",
    type: "adopter",
    name: "Jane Smith",
    email: "jane@example.com",
    phone: null,
    address: null,
    status: "active",
    status_change_notes: null,
    custom_field_data: {},
    tags: [],
    capacity: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Person;
}

export const MINIMAL_PET = {
  name: "Max",
  species: "dog",
  age_category: "young",
  sex: "male",
  size: "medium",
  status: "available",
} as const;

export const petJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ ...MINIMAL_PET, ...overrides });

export function page<T>(
  key: string,
  items: T[],
  extra: Record<string, unknown> = {},
) {
  return {
    [key]: items,
    total: items.length,
    limit: 20,
    offset: 0,
    hasMore: false,
    ...extra,
  };
}

type Answer = unknown | ((config: Record<string, unknown>) => unknown);

interface PromptConfig {
  choices?: { value: unknown }[];
  default?: unknown;
  message?: unknown;
}

export function scriptedPrompts(answers: Record<string, Answer> = {}) {
  const asked: string[] = [];
  const answer =
    (kind: string, fallback: (config: PromptConfig) => unknown) =>
    (config: PromptConfig) => {
      const message = String(config.message);
      asked.push(`${kind}:${message}`);
      const key = Object.keys(answers)
        .filter((prefix) => message.startsWith(prefix))
        .sort((left, right) => right.length - left.length)[0];
      const value = key === undefined ? fallback(config) : answers[key];
      return Promise.resolve(
        typeof value === "function"
          ? (value as (c: PromptConfig) => unknown)(config)
          : value,
      );
    };
  const prompts = {
    checkbox: answer("checkbox", () => []),
    confirm: answer("confirm", (config) => config.default ?? false),
    input: answer("input", () => ""),
    number: answer("number", () => undefined),
    password: answer("password", () => ""),
    select: answer(
      "select",
      (config) => config.default ?? config.choices?.[0]?.value,
    ),
  } as unknown as PromptAdapter;
  return { asked, prompts };
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  files?: Record<string, string>;
  interactive?: boolean;
  prompts?: PromptAdapter;
  stdin?: string;
  tty?: boolean;
}

export async function run(
  url: string,
  args: string[],
  options: RunOptions = {},
) {
  let stdout = "";
  let stderr = "";
  const code = await runCli(["node", "pawplacer", "--api-url", url, ...args], {
    env: options.env ?? { PAWPLACER_API_KEY: API_KEY },
    interactive: options.interactive ?? false,
    prompts: options.prompts ?? scriptedPrompts().prompts,
    readFile: async (path) => {
      const contents = options.files?.[path];
      if (contents === undefined) {
        throw new Error(`ENOENT: no such file, open '${path}'`);
      }
      return contents;
    },
    readStdin: async () => options.stdin ?? "",
    stderr: {
      write: (chunk: string) => {
        stderr += chunk;
        return true;
      },
    },
    stdout: {
      write: (chunk: string) => {
        stdout += chunk;
        return true;
      },
    },
    stdoutIsTTY: options.tty ?? false,
  });
  return { code, json: () => JSON.parse(stdout), stderr, stdout };
}
