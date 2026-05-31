import { describe, expect, it, vi } from "vitest";

import { createProgram, type PawPlacerClientLike } from "../src/program";

function outputBuffer() {
  let value = "";
  return {
    stream: {
      write: (chunk: string) => {
        value += chunk;
        return true;
      },
    },
    value: () => value,
    json: () => JSON.parse(value) as unknown,
  };
}

function createMockClient(): PawPlacerClientLike {
  return {
    adoptionFees: {
      get: vi.fn().mockResolvedValue([{ species: "dog" }]),
    },
    contracts: {
      get: vi.fn().mockResolvedValue({ type: "adopter", content: "terms" }),
    },
    people: {
      create: vi.fn().mockResolvedValue({ id: "person-1" }),
      get: vi.fn().mockResolvedValue({ id: "person-1" }),
      getCustomFields: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    },
    pets: {
      create: vi.fn().mockResolvedValue({ id: "pet-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: "pet-1" }),
      getByStatus: vi.fn().mockResolvedValue([]),
      getCustomFields: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      search: vi.fn().mockResolvedValue([]),
    },
  };
}

function createPrompts(overrides: Record<string, unknown> = {}): any {
  return {
    confirm: vi.fn().mockResolvedValue(true),
    editor: vi.fn().mockResolvedValue("{}"),
    input: vi.fn().mockResolvedValue(""),
    number: vi.fn().mockResolvedValue(undefined),
    password: vi.fn().mockResolvedValue("prompt-key"),
    select: vi.fn().mockResolvedValue("dog"),
    ...overrides,
  };
}

async function runCommand(
  args: string[],
  client = createMockClient(),
  extraDeps: Record<string, unknown> = {},
) {
  const stdout = outputBuffer();
  const stderr = outputBuffer();
  const clientFactory = vi.fn().mockReturnValue(client);
  const program = createProgram({
    clientFactory,
    env: {},
    interactive: false,
    prompts: createPrompts(),
    stderr: stderr.stream,
    stdout: stdout.stream,
    ...extraDeps,
  });

  await program.parseAsync(["node", "pawplacer", ...args]);

  return { client, clientFactory, stderr, stdout };
}

describe("pawplacer CLI", () => {
  it("lists pets with filters and prints JSON", async () => {
    const { client, clientFactory, stdout } = await runCommand([
      "--api-key",
      "key",
      "pets",
      "list",
      "--status",
      "available",
      "--species",
      "dog",
      "--limit",
      "2",
    ]);

    expect(clientFactory).toHaveBeenCalledWith({
      apiKey: "key",
      apiUrl: undefined,
      cache: { enabled: true },
      timeout: undefined,
    });
    expect(client.pets.list).toHaveBeenCalledWith({
      limit: 2,
      offset: undefined,
      search: undefined,
      species: "dog",
      status: "available",
      updated_since: undefined,
    });
    expect(stdout.json()).toEqual({ data: [], total: 0 });
  });

  it("creates people from inline JSON with idempotency options", async () => {
    const { client } = await runCommand([
      "--api-key",
      "key",
      "people",
      "create",
      "--json",
      '{"type":"adopter","name":"Jane"}',
      "--idempotency-key",
      "people:jane",
    ]);

    expect(client.people.create).toHaveBeenCalledWith(
      { type: "adopter", name: "Jane" },
      { idempotencyKey: "people:jane", retry: undefined },
    );
  });

  it("builds a pet create payload with prompts", async () => {
    const prompts = createPrompts({
      confirm: vi.fn().mockResolvedValue(true),
      input: vi
        .fn()
        .mockResolvedValueOnce("Max")
        .mockResolvedValueOnce("available")
        .mockResolvedValueOnce("Lab, Mix")
        .mockResolvedValueOnce("Good dog"),
      number: vi.fn().mockResolvedValue(250),
      select: vi
        .fn()
        .mockResolvedValueOnce("dog")
        .mockResolvedValueOnce("young")
        .mockResolvedValueOnce("male")
        .mockResolvedValueOnce("medium")
        .mockResolvedValueOnce("good"),
    });

    const { client } = await runCommand(
      ["--api-key", "key", "pets", "create", "--prompt"],
      createMockClient(),
      { prompts },
    );

    expect(client.pets.create).toHaveBeenCalledWith(
      {
        adoption_fee: 250,
        age_category: "young",
        breed: ["Lab", "Mix"],
        description: "Good dog",
        health: "good",
        name: "Max",
        sex: "male",
        show_public: true,
        size: "medium",
        species: "dog",
        status: "available",
      },
      { idempotencyKey: undefined, retry: undefined },
    );
  });

  it("prompts for an API key in interactive mode", async () => {
    const prompts = createPrompts();
    const { clientFactory } = await runCommand(
      ["pets", "get", "pet-1"],
      createMockClient(),
      { interactive: true, prompts },
    );

    expect(prompts.password).toHaveBeenCalled();
    expect(clientFactory).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "prompt-key" }),
    );
  });

  it("runs the guided read-only flow", async () => {
    const prompts = createPrompts({
      input: vi.fn(),
      select: vi
        .fn()
        .mockResolvedValueOnce("people:list")
        .mockResolvedValueOnce("volunteer"),
    });
    const { client, stderr } = await runCommand(
      ["--api-key", "key", "guide"],
      createMockClient(),
      { prompts },
    );

    expect(client.people.list).toHaveBeenCalledWith({
      type: "volunteer",
      limit: 20,
    });
    expect(stderr.value()).toContain("PawPlacer guide");
  });

  it("fails with a clear message when no API key is available", async () => {
    await expect(runCommand(["pets", "get", "pet-1"])).rejects.toThrow(
      "API key is required",
    );
  });

  it("mentions --prompt when create payload source is missing", async () => {
    await expect(
      runCommand(["--api-key", "key", "pets", "create"]),
    ).rejects.toThrow("--prompt");
  });
});
