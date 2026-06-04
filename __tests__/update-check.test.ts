import { describe, expect, it, vi } from "vitest";

import { checkForUpdates } from "../src/update-check";

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
  };
}

function response(version: string): Response {
  return new Response(JSON.stringify({ version }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

describe("update checks", () => {
  it("prints an update notice when npm has a newer version", async () => {
    const stderr = outputBuffer();
    const fetchImpl = vi.fn().mockResolvedValue(response("1.0.2"));
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const writeFile = vi.fn().mockResolvedValue(undefined);

    await checkForUpdates({
      cacheDir: "/tmp/pawplacer-cli-test",
      env: {},
      fetch: fetchImpl,
      mkdir,
      now: () => 1000,
      readFile: vi.fn().mockRejectedValue(new Error("missing cache")),
      stderr: stderr.stream,
      writeFile,
    });

    expect(stderr.value()).toContain(
      "A new pawplacer-cli version is available: 1.0.1 -> 1.0.2.",
    );
    expect(stderr.value()).toContain("npm install -g pawplacer-cli@latest");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/pawplacer-cli-test/update-check.json",
      `${JSON.stringify({ checkedAt: 1000, latestVersion: "1.0.2" })}\n`,
      "utf8",
    );
  });

  it("uses a fresh 48 hour cache instead of fetching", async () => {
    const stderr = outputBuffer();
    const fetchImpl = vi.fn();

    await checkForUpdates({
      cacheDir: "/tmp/pawplacer-cli-test",
      env: {},
      fetch: fetchImpl,
      now: () => 48 * 60 * 60 * 1000 - 1,
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({ checkedAt: 0, latestVersion: "1.0.2" }),
      ),
      stderr: stderr.stream,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stderr.value()).toContain("1.0.1 -> 1.0.2");
  });

  it("does not print or fetch when disabled", async () => {
    const stderr = outputBuffer();
    const fetchImpl = vi.fn();

    await checkForUpdates({
      env: { PAWPLACER_NO_UPDATE_CHECK: "1" },
      fetch: fetchImpl,
      stderr: stderr.stream,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stderr.value()).toBe("");
  });

  it("ignores update check failures", async () => {
    const stderr = outputBuffer();

    await expect(
      checkForUpdates({
        cacheDir: "/tmp/pawplacer-cli-test",
        env: {},
        fetch: vi.fn().mockRejectedValue(new Error("offline")),
        now: () => 1000,
        readFile: vi.fn().mockRejectedValue(new Error("missing cache")),
        stderr: stderr.stream,
      }),
    ).resolves.toBeUndefined();

    expect(stderr.value()).toBe("");
  });
});
