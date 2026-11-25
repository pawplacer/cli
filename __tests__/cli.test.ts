import { describe, expect, it } from "vitest";

import {
  API_KEY,
  makePerson,
  makePet,
  page,
  PET_ID,
  petJson,
  type RecordedRequest,
  run,
  scriptedPrompts,
  type StubResponse,
  useStubServer,
} from "./support";

const stub = useStubServer();

function routes(
  table: Record<string, (request: RecordedRequest) => StubResponse>,
) {
  stub.handler = (request) => {
    const route = table[`${request.method} ${request.path}`];
    return route
      ? route(request)
      : { status: 404, body: { error: "Not found", code: "not_found" } };
  };
}

const petPage =
  (extra: Record<string, unknown> = {}) =>
  () => ({
    body: page("pets", [makePet()], extra),
  });

describe("reading pets", () => {
  it("passes list filters through and prints JSON when piped", async () => {
    routes({ "GET /api/pets": petPage() });

    const result = await run(stub.url, [
      "pets",
      "list",
      "--status",
      "available",
      "--species",
      "dog",
      "--search",
      "max",
      "--since",
      "2026-11-01",
      "--limit",
      "5",
    ]);

    expect(result.code).toBe(0);
    expect(Object.fromEntries(stub.requests[0]?.query ?? [])).toEqual({
      limit: "5",
      search: "max",
      species: "dog",
      status: "available",
      updated_since: "2026-11-01",
    });
    expect(stub.requests[0]?.headers["x-api-key"]).toBe(API_KEY);
    expect(result.json()).toMatchObject({ data: [{ id: PET_ID }], total: 1 });
  });

  it("prints a table in a terminal and JSON with --json", async () => {
    routes({ "GET /api/pets": petPage({ total: 30, hasMore: true }) });

    const table = await run(stub.url, ["pets", "list"], { tty: true });
    expect(table.stdout).toContain("ID");
    expect(table.stdout).toContain("Max");
    expect(table.stdout).toContain(
      "Showing 1-1 of 30 pets. Next page: --offset 20, or --all for everything.",
    );

    const json = await run(stub.url, ["pets", "list", "--json"], { tty: true });
    expect(json.json()).toMatchObject({ total: 30, hasMore: true });
  });

  it("fetches every page with --all", async () => {
    stub.handler = (request) => {
      const offset = Number(request.query.get("offset") ?? 0);
      return {
        body: page(
          "pets",
          [makePet({ id: `pet-${offset}`, name: `Pet ${offset}` })],
          { offset, limit: 1, total: 3, hasMore: offset < 2 },
        ),
      };
    };

    const result = await run(stub.url, [
      "pets",
      "list",
      "--all",
      "--limit",
      "1",
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(3);
    expect(result.json()).toEqual({
      data: [
        expect.objectContaining({ id: "pet-0" }),
        expect.objectContaining({ id: "pet-1" }),
        expect.objectContaining({ id: "pet-2" }),
      ],
      total: 3,
    });
  });

  it("rejects bad list options before calling the API", async () => {
    const species = await run(stub.url, [
      "pets",
      "list",
      "--species",
      "lizard",
    ]);
    expect(species.code).toBe(2);
    expect(species.stderr).toContain("--species must be one of: dog, cat");

    const limit = await run(stub.url, ["pets", "list", "--limit", "500"]);
    expect(limit.stderr).toContain("--limit must be a whole number, 1-100.");

    const since = await run(stub.url, ["pets", "list", "--since", "yesterday"]);
    expect(since.stderr).toContain("--since must be an ISO date");

    const allOffset = await run(stub.url, [
      "pets",
      "list",
      "--all",
      "--offset",
      "2",
    ]);
    expect(allOffset.stderr).toContain(
      "--all can't be combined with --offset.",
    );

    expect(stub.requests).toHaveLength(0);
  });

  it("shows one pet as readable fields in a terminal", async () => {
    routes({
      [`GET /api/pets/${PET_ID}`]: () => ({
        body: makePet({ custom_field_data: { kennel: "A12" } }),
      }),
    });

    const result = await run(stub.url, ["pets", "get", PET_ID], { tty: true });

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^Max\n/);
    expect(result.stdout).toMatch(/Species\s+Dog/);
    expect(result.stdout).toMatch(/Kennel\s+A12/);
  });

  it("warns on stderr when the workspace has sample data", async () => {
    routes({
      "GET /api/pets": () => ({
        body: page("pets", [makePet({ is_sample: true })]),
        headers: { "x-pawplacer-sample-data": "true" },
      }),
    });

    const result = await run(stub.url, ["pets", "list"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("this workspace still has sample data");
    expect(result.json().data[0].is_sample).toBe(true);

    const quiet = await run(stub.url, ["pets", "list", "--quiet"]);
    expect(quiet.stderr).toBe("");
  });
});

describe("writing pets", () => {
  it("creates from --data with a stable idempotency key", async () => {
    routes({
      "POST /api/pets": (request) => ({ body: makePet(request.body as never) }),
    });

    const result = await run(stub.url, [
      "pets",
      "create",
      "--data",
      '{"name":"Maple","species":"dog","age_category":"adult","sex":"female","size":"medium","status":"available"}',
      "--idempotency-key",
      "pet:maple",
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests[0]?.headers["idempotency-key"]).toBe("pet:maple");
    expect(stub.requests[0]?.body).toMatchObject({ name: "Maple" });
    expect(result.json()).toMatchObject({ name: "Maple" });
  });

  it("sends no idempotency key with --no-idempotency-key", async () => {
    routes({ "POST /api/pets": () => ({ body: makePet() }) });

    await run(stub.url, [
      "pets",
      "create",
      "--data",
      petJson(),
      "--no-idempotency-key",
    ]);

    expect(stub.requests[0]?.headers["idempotency-key"]).toBeUndefined();
  });

  it("reads the payload from piped stdin, --file -, and --file <path>", async () => {
    routes({ "POST /api/pets": () => ({ body: makePet() }) });

    await run(stub.url, ["pets", "create"], {
      stdin: petJson({ name: "Piped" }),
    });
    await run(stub.url, ["pets", "create", "--file", "-"], {
      stdin: petJson({ name: "Dash" }),
    });
    await run(stub.url, ["pets", "create", "--file", "pet.json"], {
      files: { "pet.json": petJson({ name: "File" }) },
    });

    expect(
      stub.requests.map((request) => (request.body as { name: string }).name),
    ).toEqual(["Piped", "Dash", "File"]);
  });

  it("explains how to pass a payload when nothing is piped", async () => {
    const result = await run(stub.url, ["pets", "create"]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "No payload given. Pass --data '<json>', --file <path>, or --prompt.",
    );
  });

  it("refuses two payload sources at once", async () => {
    const result = await run(stub.url, [
      "pets",
      "create",
      "--data",
      "{}",
      "--file",
      "pet.json",
    ]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "Use only one of --data, --file, or --prompt.",
    );
  });

  it("updates by custom_id and passes empty values through so fields clear", async () => {
    routes({
      "PATCH /api/pets/DOG-1": () => ({ body: makePet({ description: "" }) }),
    });

    const result = await run(stub.url, [
      "pets",
      "update",
      "DOG-1",
      "--data",
      '{"description":"","breed":[]}',
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests[0]?.body).toEqual({ description: "", breed: [] });
  });
});

describe("errors", () => {
  it("shows the API's message, code, hint, and request ID", async () => {
    routes({
      "POST /api/pets": () => ({
        status: 403,
        body: {
          error: "This API key does not have write access.",
          code: "insufficient_scope",
          request_id: "req-123",
        },
      }),
    });

    const result = await run(stub.url, ["pets", "create", "--data", petJson()]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "API error 403 [insufficient_scope] This API key does not have write access.",
    );
    expect(result.stderr).toContain("Hint: This key is read-only.");
    expect(result.stderr).toContain("Request ID: req-123");
  });

  it("lists validation details", async () => {
    routes({
      "POST /api/people": () => ({
        status: 400,
        body: {
          error: "Validation failed",
          code: "validation_failed",
          details: { email: "must be an email address" },
        },
      }),
    });

    const result = await run(stub.url, [
      "people",
      "create",
      "--data",
      '{"type":"adopter","name":"Jane","email":"nope"}',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("- email: must be an email address");
  });

  it("names the API URL when it can't connect", async () => {
    const result = await run("http://127.0.0.1:1", [
      "pets",
      "create",
      "--data",
      petJson(),
      "--no-idempotency-key",
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Could not reach http://127.0.0.1:1");
  });

  it("asks for an API key setup when none is available", async () => {
    const result = await run(stub.url, ["pets", "list"], { env: {} });

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      "No API key. Set PAWPLACER_API_KEY or pass --api-key.",
    );
  });

  it("prompts for the key in a terminal", async () => {
    routes({ "GET /api/pets": petPage() });
    const { prompts } = scriptedPrompts({
      "PawPlacer API key": "ppk_live_prompted.secret",
    });

    const result = await run(stub.url, ["pets", "list"], {
      env: {},
      interactive: true,
      prompts,
    });

    expect(result.code).toBe(0);
    expect(stub.requests[0]?.headers["x-api-key"]).toBe(
      "ppk_live_prompted.secret",
    );
  });

  it("points 1.x commands and flags at their replacements", async () => {
    const search = await run(stub.url, ["pets", "search", "dog"]);
    expect(search.code).toBe(2);
    expect(search.stderr).toContain(
      "Use `pawplacer pets list --search <query>`.",
    );

    const status = await run(stub.url, ["pets", "status", "available"]);
    expect(status.stderr).toContain(
      "Use `pawplacer pets list --status <status>`.",
    );

    const stdin = await run(stub.url, ["pets", "create", "--stdin"]);
    expect(stdin.stderr).toContain("--stdin was removed in 2.0.");

    const json = await run(stub.url, [
      "pets",
      "create",
      "--json",
      '{"name":"Max"}',
    ]);
    expect(json.stderr).toContain("Pass inline payloads with --data '<json>'.");

    expect(stub.requests).toHaveLength(0);
  });

  it("exits 2 for usage errors and 0 for --help", async () => {
    const unknown = await run(stub.url, ["pets", "nope"]);
    expect(unknown.code).toBe(2);

    const badType = await run(stub.url, ["people", "list", "--type", "donor"]);
    expect(badType.code).toBe(2);
    expect(badType.stderr).toContain(
      "Allowed choices are adopter, foster, surrender, volunteer.",
    );

    const help = await run(stub.url, ["pets", "list", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--all");
  });
});

describe("people, fees, and contracts", () => {
  it("lists and fetches people by type", async () => {
    routes({
      "GET /api/people": () => ({
        body: { ...page("people", [makePerson()]), type: "adopter" },
      }),
      "GET /api/people/person-1": () => ({
        body: makePerson({ type: "foster" }),
      }),
    });

    const list = await run(stub.url, [
      "people",
      "list",
      "--type",
      "adopter",
      "--status",
      "active",
    ]);
    expect(list.code).toBe(0);
    expect(stub.requests[0]?.query.get("type")).toBe("adopter");
    expect(stub.requests[0]?.query.get("status")).toBe("active");

    const get = await run(stub.url, [
      "people",
      "get",
      "person-1",
      "--type",
      "foster",
    ]);
    expect(get.code).toBe(0);
    expect(stub.requests[1]?.query.get("type")).toBe("foster");
  });

  it("prints a contract's text in a terminal", async () => {
    routes({
      "GET /api/contracts": () => ({
        body: {
          type: "adopter",
          content: "# Terms\nBe kind.",
          updated_at: null,
        },
      }),
    });

    const result = await run(stub.url, ["contracts", "--type", "adopter"], {
      tty: true,
    });

    expect(result.stdout).toContain("Adopter contract");
    expect(result.stdout).toContain("# Terms\nBe kind.");
  });
});

describe("doctor", () => {
  it("reports the key preview, API version, rate limit, and sample-data state", async () => {
    routes({
      "GET /api/pets": () => ({
        body: page("pets", [makePet()], { total: 249 }),
        headers: {
          "x-api-version": "1.6.0",
          "x-request-id": "req-1",
          "x-ratelimit-limit": "2000",
          "x-ratelimit-remaining": "1999",
          "x-ratelimit-reset": "1800000000",
          "x-pawplacer-sample-data": "true",
        },
      }),
    });

    const result = await run(stub.url, ["doctor", "--quiet"]);

    expect(result.code).toBe(0);
    expect(result.json()).toMatchObject({
      apiKey: "ppk_live_test.***",
      apiUrl: stub.url,
      apiVersion: "1.6.0",
      petsVisible: 249,
      rateLimit: { limit: 2000, remaining: 1999 },
      requestId: "req-1",
      sampleData: true,
    });
    expect(result.stdout).not.toContain("secret");
  });
});

describe("prompts", () => {
  it("builds a pet from prompts and skips optional answers left blank", async () => {
    routes({
      "GET /api/pets/custom-fields": () => ({ body: { custom_fields: [] } }),
      "POST /api/pets": () => ({ body: makePet() }),
    });
    const { prompts } = scriptedPrompts({
      "Pet name": "Biscuit",
      Species: "small_furry",
      "Age category": "young",
      Sex: "female",
      Size: "small",
      Status: "available",
      Health: "__not_set__",
      "Add more details?": ["color", "intake_date"],
      Colors: "Brown, White",
      "Intake date": "2026-11-20",
      "Show publicly?": false,
    });

    const result = await run(stub.url, ["pets", "create"], {
      interactive: true,
      prompts,
    });

    expect(result.code).toBe(0);
    expect(stub.requests.at(-1)?.body).toEqual({
      name: "Biscuit",
      species: "small_furry",
      age_category: "young",
      sex: "female",
      size: "small",
      status: "available",
      color: ["Brown", "White"],
      intake_date: "2026-11-20",
      show_public: false,
    });
  });

  it("accepts a status that isn't in the default list", async () => {
    routes({
      "GET /api/pets/custom-fields": () => ({ body: { custom_fields: [] } }),
      "POST /api/pets": () => ({ body: makePet() }),
    });
    const { prompts } = scriptedPrompts({
      "Pet name": "Biscuit",
      Status: "__other_status__",
      "Status name, label, or ID": "Ready for Adoption",
    });

    await run(stub.url, ["pets", "create", "--prompt"], {
      interactive: true,
      prompts,
    });

    expect(stub.requests.at(-1)?.body).toMatchObject({
      status: "Ready for Adoption",
    });
  });

  it("clears a field on update when its answer is left blank", async () => {
    routes({
      "GET /api/pets/custom-fields": () => ({ body: { custom_fields: [] } }),
      [`PATCH /api/pets/${PET_ID}`]: () => ({ body: makePet() }),
    });
    const { prompts } = scriptedPrompts({
      "Fields to update": ["description", "breed"],
      "Description (leave blank to clear)": "",
      "Breeds, comma-separated (leave blank to clear)": "Beagle",
    });

    await run(stub.url, ["pets", "update", PET_ID], {
      interactive: true,
      prompts,
    });

    expect(stub.requests.at(-1)?.body).toEqual({
      description: "",
      breed: ["Beagle"],
    });
  });

  it("asks volunteers for their skills and interests", async () => {
    routes({
      "GET /api/people/custom-fields": () => ({
        body: { type: "volunteer", custom_fields: [] },
      }),
      "POST /api/people": () => ({ body: makePerson({ type: "volunteer" }) }),
    });
    const { prompts } = scriptedPrompts({
      "Person type": "volunteer",
      Name: "Val",
      Status: "training",
      Skills: "Dog walking, Photography",
      Languages: "Spanish",
    });

    await run(stub.url, ["people", "create"], { interactive: true, prompts });

    expect(stub.requests.at(-1)?.body).toEqual({
      type: "volunteer",
      name: "Val",
      status: "training",
      skills: ["Dog walking", "Photography"],
      languages: ["Spanish"],
    });
  });

  it("shows the contract and submits an application once terms are accepted", async () => {
    routes({
      "GET /api/people/custom-fields": () => ({
        body: { type: "adopter", custom_fields: [] },
      }),
      "GET /api/contracts": () => ({
        body: { type: "adopter", content: "Adopter terms", updated_at: null },
      }),
      "POST /api/people": () => ({ body: makePerson() }),
    });
    const { prompts } = scriptedPrompts({
      "Person type": "adopter",
      Name: "Jane",
      "Submit this person as an application": true,
      "PawPlacer pet IDs": `${PET_ID}`,
      "Did the applicant accept": true,
    });

    const result = await run(stub.url, ["people", "create"], {
      interactive: true,
      prompts,
    });

    expect(result.stderr).toContain("Adopter terms");
    expect(stub.requests.at(-1)?.body).toMatchObject({
      status: "pending",
      application: { pet_ids: [PET_ID], terms_accepted: true },
    });
  });

  it("doesn't submit an application when the terms are refused", async () => {
    routes({
      "GET /api/people/custom-fields": () => ({
        body: { type: "adopter", custom_fields: [] },
      }),
      "GET /api/contracts": () => ({
        body: { type: "adopter", content: "Adopter terms", updated_at: null },
      }),
    });
    const { prompts } = scriptedPrompts({
      "Person type": "adopter",
      Name: "Jane",
      "Submit this person as an application": true,
      "PawPlacer pet IDs": PET_ID,
      "Did the applicant accept": false,
    });

    const result = await run(stub.url, ["people", "create"], {
      interactive: true,
      prompts,
    });

    expect(result.code).toBe(2);
    expect(stub.requests.some((request) => request.method === "POST")).toBe(
      false,
    );
  });

  it("runs guide tasks through pets.list", async () => {
    routes({ "GET /api/pets": petPage() });
    const { prompts } = scriptedPrompts({
      "What do you want to do?": "pets:search",
      "Search for": "max",
    });

    const result = await run(stub.url, ["guide"], {
      interactive: true,
      prompts,
    });

    expect(result.code).toBe(0);
    expect(stub.requests[0]?.query.get("search")).toBe("max");
  });

  it("needs a terminal for guide and --prompt", async () => {
    const guide = await run(stub.url, ["guide"]);
    expect(guide.code).toBe(2);
    expect(guide.stderr).toContain("guide needs an interactive terminal.");

    const prompt = await run(stub.url, ["pets", "create", "--prompt"]);
    expect(prompt.stderr).toContain("--prompt needs an interactive terminal.");
  });
});
