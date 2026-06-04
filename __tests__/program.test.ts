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
    checkbox: vi.fn().mockResolvedValue([]),
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
    const client = createMockClient();
    vi.mocked(client.pets.getCustomFields).mockResolvedValue([
      {
        field_key: "name",
        field_type: "text",
        label: "Name",
        required: true,
      },
      {
        field_key: "favorite_toy",
        field_type: "text",
        label: "Favorite toy",
        required: true,
      },
      {
        field_key: "energy_level",
        field_type: "select",
        label: "Energy level",
        options: ["Low", "Medium", "High"],
        required: false,
      },
      {
        field_key: "medical_conditions",
        field_type: "multiselect",
        label: "Medical Conditions",
        options: ["Allergies", "Anxiety"],
        required: false,
        section: "Health & Medical",
      },
      {
        field_key: "tags",
        field_type: "multiselect",
        label: "Tags",
        options: ["Urgent"],
        required: false,
        section: "Health & Medical",
      },
    ]);
    const prompts = createPrompts({
      checkbox: vi
        .fn()
        .mockResolvedValueOnce([
          "color",
          "spayed",
          "good_with",
          "temperaments",
          "special_needs",
        ])
        .mockResolvedValueOnce(["dogs", "kids"])
        .mockResolvedValueOnce(["playful"])
        .mockResolvedValueOnce(["Allergies"]),
      confirm: vi.fn().mockResolvedValue(true),
      input: vi
        .fn()
        .mockResolvedValueOnce("Max")
        .mockResolvedValueOnce("Lab, Mix")
        .mockResolvedValueOnce("Good dog")
        .mockResolvedValueOnce("Black, White")
        .mockResolvedValueOnce("Ball"),
      number: vi.fn().mockResolvedValue(250),
      select: vi
        .fn()
        .mockResolvedValueOnce("dog")
        .mockResolvedValueOnce("young")
        .mockResolvedValueOnce("male")
        .mockResolvedValueOnce("medium")
        .mockResolvedValueOnce("available")
        .mockResolvedValueOnce("good")
        .mockResolvedValueOnce("energy_level")
        .mockResolvedValueOnce("High")
        .mockResolvedValueOnce("__pawplacer_done__"),
    });

    await runCommand(
      ["--api-key", "key", "pets", "create", "--prompt"],
      client,
      { prompts },
    );

    expect(client.pets.getCustomFields).toHaveBeenCalled();
    expect(prompts.select).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.arrayContaining([
          { name: "Available", value: "available" },
          { name: "Medical Hold", value: "medicalHold" },
          { name: "Returned To Owner", value: "returnedToOwner" },
        ]),
        default: "available",
        message: "Status",
      }),
    );
    expect(prompts.input).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Name (required)",
      }),
    );
    expect(prompts.select).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.not.arrayContaining([
          expect.objectContaining({
            name: "Health & Medical: Medical Conditions",
          }),
          expect.objectContaining({
            name: "Health & Medical: Tags",
          }),
        ]),
        message: "Add custom field",
      }),
    );
    expect(client.pets.create).toHaveBeenCalledWith(
      {
        adoption_fee: 250,
        age_category: "young",
        breed: ["Lab", "Mix"],
        color: ["Black", "White"],
        custom_field_data: {
          energy_level: "High",
          favorite_toy: "Ball",
        },
        description: "Good dog",
        good_with: ["dogs", "kids"],
        health: "good",
        name: "Max",
        sex: "male",
        show_public: true,
        size: "medium",
        species: "dog",
        spayed: true,
        special_needs: ["Allergies"],
        status: "available",
        temperaments: ["playful"],
      },
      { idempotencyKey: undefined, retry: undefined },
    );
  });

  it("builds a person create payload with prompted custom fields", async () => {
    const client = createMockClient();
    vi.mocked(client.people.getCustomFields).mockResolvedValue([
      {
        field_key: "full_name",
        field_type: "text",
        label: "Full Name",
        required: true,
        section: "Personal Information",
      },
      {
        field_key: "email_address",
        field_type: "email",
        label: "Email Address",
        required: true,
        section: "Personal Information",
      },
      {
        field_key: "experience",
        field_type: "text",
        help_text: "Prior pet experience",
        label: "Experience",
        required: true,
      },
      {
        field_key: "housing",
        field_type: "select",
        label: "Housing type",
        options: [
          { label: "Apartment", value: "apartment" },
          { label: "House", value: "house" },
        ],
        required: false,
        section: "Home",
      },
      {
        field_key: "availability",
        field_type: "multi_select",
        label: "Availability",
        options: ["Weekdays", "Weekends"],
        required: false,
      },
      {
        field_key: "internal_code",
        field_type: "text",
        hidden: true,
        label: "Internal code",
        required: false,
      },
    ]);
    const prompts = createPrompts({
      checkbox: vi.fn().mockResolvedValueOnce(["Weekends"]),
      input: vi
        .fn()
        .mockResolvedValueOnce("Jane")
        .mockResolvedValueOnce("jane@example.com")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("Has fostered before"),
      select: vi
        .fn()
        .mockResolvedValueOnce("adopter")
        .mockResolvedValueOnce("active")
        .mockResolvedValueOnce("housing")
        .mockResolvedValueOnce("house")
        .mockResolvedValueOnce("availability")
        .mockResolvedValueOnce("__pawplacer_done__"),
    });

    await runCommand(["--api-key", "key", "people", "create", "--prompt"], client, {
      prompts,
    });

    expect(client.people.getCustomFields).toHaveBeenCalledWith("adopter");
    expect(prompts.select).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.arrayContaining([
          { name: "Pending", value: "pending" },
          { name: "Active", value: "active" },
          { name: "Training", value: "training" },
        ]),
        default: "active",
        message: "Status",
      }),
    );
    expect(prompts.checkbox).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          { name: "Weekdays", value: "Weekdays" },
          { name: "Weekends", value: "Weekends" },
        ],
        message: "Availability",
      }),
    );
    expect(prompts.select).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: expect.arrayContaining([
          expect.objectContaining({
            description: "Options: Apartment, House",
            name: "Home: Housing type",
            value: "housing",
          }),
          expect.objectContaining({
            description: "Options: Weekdays, Weekends",
            name: "Availability",
            value: "availability",
          }),
          expect.objectContaining({
            name: "Done adding custom fields",
            value: "__pawplacer_done__",
          }),
        ]),
        message: "Add custom field",
      }),
    );
    expect(prompts.input).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Personal Information: Full Name (required)",
      }),
    );
    expect(client.people.create).toHaveBeenCalledWith(
      {
        custom_field_data: {
          availability: ["Weekends"],
          experience: "Has fostered before",
          housing: "house",
        },
        email: "jane@example.com",
        name: "Jane",
        status: "active",
        type: "adopter",
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
