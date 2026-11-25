import chalk from "chalk";
import { describe, expect, it, vi } from "vitest";

import { startUpdateCheck, type UpdateCheckDeps } from "../src/update-check";

chalk.level = 0;

function npmResponse(version: string) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ version }), {
      headers: { "content-type": "application/json" },
    }),
  );
}

function deps(overrides: Partial<UpdateCheckDeps> = {}): UpdateCheckDeps {
  return {
    cacheDir: "/tmp/pawplacer-cli-test",
    currentVersion: "2.0.0",
    env: {},
    fetch: npmResponse("2.1.0"),
    mkdir: vi.fn().mockResolvedValue(undefined),
    now: () => 10_000,
    readFile: vi.fn().mockRejectedValue(new Error("no cache")),
    stderrIsTTY: true,
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("update check", () => {
  it("returns a notice when npm has a newer CLI", async () => {
    const options = deps();
    const notice = await startUpdateCheck(options);

    expect(notice).toContain("pawplacer-cli 2.0.0 -> 2.1.0");
    expect(notice).toContain("npm install -g pawplacer-cli@latest");
    expect(options.writeFile).toHaveBeenCalledWith(
      "/tmp/pawplacer-cli-test/update-check.json",
      expect.stringContaining('"latestVersion":"2.1.0"'),
      "utf8",
    );
  });

  it("stays quiet when the CLI is current", async () => {
    expect(
      await startUpdateCheck(deps({ fetch: npmResponse("2.0.0") })),
    ).toBeUndefined();
  });

  it("uses the cached version inside the TTL without calling npm", async () => {
    const fetchImpl = npmResponse("9.9.9");
    const notice = await startUpdateCheck(
      deps({
        fetch: fetchImpl,
        readFile: vi.fn().mockResolvedValue(
          JSON.stringify({
            checkedAt: 9_000,
            latestVersion: "2.0.1",
            schemaVersion: 3,
          }),
        ) as never,
      }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(notice).toContain("2.0.0 -> 2.0.1");
  });

  it.each([
    ["CI", { env: { CI: "true" } }],
    ["PAWPLACER_NO_UPDATE_CHECK", { env: { PAWPLACER_NO_UPDATE_CHECK: "1" } }],
    ["a non-terminal stderr", { stderrIsTTY: false }],
  ])("skips the check under %s", async (_label, overrides) => {
    const options = deps(overrides);

    expect(await startUpdateCheck(options)).toBeUndefined();
    expect(options.fetch).not.toHaveBeenCalled();
  });

  it("never fails the command when npm is unreachable", async () => {
    expect(
      await startUpdateCheck(
        deps({ fetch: vi.fn().mockRejectedValue(new Error("offline")) }),
      ),
    ).toBeUndefined();
  });
});
