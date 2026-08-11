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

function versionFetch(cliVersion: string, sdkVersion: string) {
  return vi
    .fn()
    .mockImplementation((input: string | URL | Request) =>
      Promise.resolve(
        response(
          String(input).includes("pawplacer-cli") ? cliVersion : sdkVersion,
        ),
      ),
    );
}

describe("update checks", () => {
  it("prints an update notice when npm has a newer version", async () => {
    const stderr = outputBuffer();
    const fetchImpl = versionFetch("1.2.1", "1.6.0");
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

    expect(stderr.value()).toContain("┌");
    expect(stderr.value()).toContain("│ ↻ Update available");
    expect(stderr.value()).toContain("└");
    expect(stderr.value()).toContain("↻ Update available");
    expect(stderr.value()).toContain("pawplacer-cli 1.2.0 -> 1.2.1");
    expect(stderr.value()).toContain("npm install -g pawplacer-cli@latest");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/pawplacer-cli-test/update-check.json",
      `${JSON.stringify({
        schemaVersion: 2,
        checkedAt: 1000,
        latestCliVersion: "1.2.1",
        latestSdkVersion: "1.6.0",
      })}\n`,
      "utf8",
    );
  });

  it("prints an update notice when npm has a newer SDK", async () => {
    const stderr = outputBuffer();

    await checkForUpdates({
      cacheDir: "/tmp/pawplacer-cli-test",
      env: {},
      fetch: versionFetch("1.2.0", "1.7.0"),
      mkdir: vi.fn().mockResolvedValue(undefined),
      now: () => 1000,
      readFile: vi.fn().mockRejectedValue(new Error("missing cache")),
      stderr: stderr.stream,
      writeFile: vi.fn().mockResolvedValue(undefined),
    });

    expect(stderr.value()).toContain("pawplacer-sdk 1.6.0 -> 1.7.0");
    expect(stderr.value()).toContain("npm install -g pawplacer-cli@latest");
  });

  it("still reports an SDK update when the CLI registry request fails", async () => {
    const stderr = outputBuffer();
    const fetchImpl = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        if (String(input).includes("pawplacer-cli")) {
          return Promise.reject(new Error("CLI registry unavailable"));
        }
        return Promise.resolve(response("1.7.0"));
      });

    await checkForUpdates({
      cacheDir: "/tmp/pawplacer-cli-test",
      currentSdkVersion: "1.6.0",
      env: {},
      fetch: fetchImpl,
      mkdir: vi.fn().mockResolvedValue(undefined),
      now: () => 1000,
      readFile: vi.fn().mockRejectedValue(new Error("missing cache")),
      stderr: stderr.stream,
      writeFile: vi.fn().mockResolvedValue(undefined),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(stderr.value()).toContain("pawplacer-sdk 1.6.0 -> 1.7.0");
  });

  it("uses a fresh 48 hour cache instead of fetching", async () => {
    const stderr = outputBuffer();
    const fetchImpl = vi.fn();

    await checkForUpdates({
      cacheDir: "/tmp/pawplacer-cli-test",
      currentSdkVersion: "1.6.0",
      env: {},
      fetch: fetchImpl,
      now: () => 48 * 60 * 60 * 1000 - 1,
      readFile: vi.fn().mockResolvedValue(
        JSON.stringify({
          schemaVersion: 2,
          checkedAt: 0,
          latestCliVersion: "1.2.1",
          latestSdkVersion: "1.6.0",
        }),
      ),
      stderr: stderr.stream,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(stderr.value()).toContain("1.2.0 -> 1.2.1");
  });

  it("refreshes a legacy cache so SDK updates are not delayed", async () => {
    const fetchImpl = versionFetch("1.2.0", "1.6.0");

    await checkForUpdates({
      cacheDir: "/tmp/pawplacer-cli-test",
      currentSdkVersion: "1.6.0",
      env: {},
      fetch: fetchImpl,
      mkdir: vi.fn().mockResolvedValue(undefined),
      now: () => 1000,
      readFile: vi
        .fn()
        .mockResolvedValue(
          JSON.stringify({ checkedAt: 999, latestVersion: "1.1.0" }),
        ),
      stderr: outputBuffer().stream,
      writeFile: vi.fn().mockResolvedValue(undefined),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
        currentSdkVersion: "1.6.0",
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
