import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import chalk from "chalk";

import packageJson from "../package.json";

type Writable = Pick<NodeJS.WriteStream, "write">;

interface UpdateCache {
  checkedAt?: number;
  latestCliVersion?: string;
  latestSdkVersion?: string;
  schemaVersion?: number;
}

export interface UpdateCheckDeps {
  cacheDir?: string;
  cacheTtlMs?: number;
  currentSdkVersion?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  mkdir?: typeof mkdir;
  now?: () => number;
  readFile?: typeof readFile;
  stderr?: Writable;
  timeoutMs?: number;
  writeFile?: typeof writeFile;
}

const CLI_PACKAGE_NAME = "pawplacer-cli";
const SDK_PACKAGE_NAME = "pawplacer-sdk";
const NPM_LATEST_URLS = {
  cli: `https://registry.npmjs.org/${CLI_PACKAGE_NAME}/latest`,
  sdk: `https://registry.npmjs.org/${SDK_PACKAGE_NAME}/latest`,
};
const DEFAULT_CACHE_TTL_MS = 48 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 750;
const UPDATE_CACHE_SCHEMA_VERSION = 2;

function parseVersion(version: string): number[] | undefined {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return undefined;
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) {
    return 0;
  }

  for (let index = 0; index < parsedLeft.length; index += 1) {
    const diff = (parsedLeft[index] ?? 0) - (parsedRight[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function updateCheckDisabled(env: NodeJS.ProcessEnv): boolean {
  return ["1", "true", "yes"].includes(
    env.PAWPLACER_NO_UPDATE_CHECK?.toLowerCase() ?? "",
  );
}

function defaultCacheDir(env: NodeJS.ProcessEnv): string | undefined {
  if (env.XDG_CACHE_HOME) {
    return join(env.XDG_CACHE_HOME, "pawplacer-cli");
  }
  const home = homedir();
  return home ? join(home, ".cache", "pawplacer-cli") : undefined;
}

function parseCache(contents: string): UpdateCache | undefined {
  try {
    const value = JSON.parse(contents) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const cache = value as Record<string, unknown>;
    const legacyLatestVersion =
      typeof cache.latestVersion === "string" ? cache.latestVersion : undefined;
    return {
      checkedAt:
        typeof cache.checkedAt === "number" ? cache.checkedAt : undefined,
      latestCliVersion:
        typeof cache.latestCliVersion === "string"
          ? cache.latestCliVersion
          : legacyLatestVersion,
      latestSdkVersion:
        typeof cache.latestSdkVersion === "string"
          ? cache.latestSdkVersion
          : undefined,
      schemaVersion:
        typeof cache.schemaVersion === "number"
          ? cache.schemaVersion
          : undefined,
    };
  } catch {
    return undefined;
  }
}

async function readCache(
  cachePath: string,
  readFileImpl: typeof readFile,
): Promise<UpdateCache | undefined> {
  try {
    return parseCache(await readFileImpl(cachePath, "utf8"));
  } catch {
    return undefined;
  }
}

async function writeCache(
  cacheDir: string,
  latestVersions: Pick<UpdateCache, "latestCliVersion" | "latestSdkVersion">,
  deps: Required<Pick<UpdateCheckDeps, "mkdir" | "now" | "writeFile">>,
): Promise<void> {
  try {
    await deps.mkdir(cacheDir, { recursive: true });
    await deps.writeFile(
      join(cacheDir, "update-check.json"),
      `${JSON.stringify({
        schemaVersion: UPDATE_CACHE_SCHEMA_VERSION,
        checkedAt: deps.now(),
        ...latestVersions,
      })}\n`,
      "utf8",
    );
  } catch {
    // Update checks should never make the CLI command itself fail.
  }
}

async function fetchLatestVersion(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return undefined;
    }

    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return undefined;
    }

    const version = (body as Record<string, unknown>).version;
    return typeof version === "string" ? version : undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function detectInstalledSdkVersion(): Promise<string | undefined> {
  let entryPath: string;
  try {
    entryPath = createRequire(import.meta.url).resolve(SDK_PACKAGE_NAME);
  } catch {
    return undefined;
  }

  let directory = dirname(entryPath);
  while (true) {
    try {
      const contents = await readFile(join(directory, "package.json"), "utf8");
      const manifest = JSON.parse(contents) as unknown;
      if (
        manifest &&
        typeof manifest === "object" &&
        !Array.isArray(manifest) &&
        (manifest as Record<string, unknown>).name === SDK_PACKAGE_NAME
      ) {
        const version = (manifest as Record<string, unknown>).version;
        return typeof version === "string" ? version : undefined;
      }
    } catch {
      // Keep walking until the dependency package root is found.
    }

    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

interface PackageUpdate {
  currentVersion: string;
  latestVersion: string;
  packageName: string;
}

function formatUpdateNotice(updates: PackageUpdate[]): string {
  const command = "npm install -g pawplacer-cli@latest";
  const rows = [
    {
      raw: "↻ Update available",
      styled: `${chalk.yellow("↻")} ${chalk.bold("Update available")}`,
    },
    ...updates.map(({ currentVersion, latestVersion, packageName }) => ({
      raw: `${packageName} ${currentVersion} -> ${latestVersion}`,
      styled: chalk.gray(
        `${packageName} ${currentVersion} -> ${latestVersion}`,
      ),
    })),
    {
      raw: `Run ${command} and restart pawplacer.`,
      styled: `Run ${chalk.cyan(command)} and restart pawplacer.`,
    },
  ];
  const width = Math.max(56, ...rows.map((row) => row.raw.length));
  const horizontal = "─".repeat(width + 2);

  return [
    chalk.yellow(`┌${horizontal}┐`),
    ...rows.map(
      (row) =>
        `${chalk.yellow("│")} ${row.styled}${" ".repeat(
          width - row.raw.length,
        )} ${chalk.yellow("│")}`,
    ),
    chalk.yellow(`└${horizontal}┘`),
  ].join("\n");
}

export async function checkForUpdates(
  deps: UpdateCheckDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  if (updateCheckDisabled(env)) {
    return;
  }

  const stderr = deps.stderr ?? process.stderr;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    return;
  }

  const now = deps.now ?? Date.now;
  const cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cacheDir = deps.cacheDir ?? defaultCacheDir(env);
  const readFileImpl = deps.readFile ?? readFile;
  const cachePath = cacheDir ? join(cacheDir, "update-check.json") : undefined;
  const cached = cachePath
    ? await readCache(cachePath, readFileImpl)
    : undefined;

  let latestCliVersion: string | undefined;
  let latestSdkVersion: string | undefined;
  if (
    cached?.schemaVersion === UPDATE_CACHE_SCHEMA_VERSION &&
    (cached?.latestCliVersion || cached?.latestSdkVersion) &&
    typeof cached.checkedAt === "number" &&
    now() - cached.checkedAt < cacheTtlMs
  ) {
    latestCliVersion = cached.latestCliVersion;
    latestSdkVersion = cached.latestSdkVersion;
  } else {
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const [fetchedCliVersion, fetchedSdkVersion] = await Promise.all([
      fetchLatestVersion(fetchImpl, NPM_LATEST_URLS.cli, timeoutMs).catch(
        () => undefined,
      ),
      fetchLatestVersion(fetchImpl, NPM_LATEST_URLS.sdk, timeoutMs).catch(
        () => undefined,
      ),
    ]);
    latestCliVersion = fetchedCliVersion ?? cached?.latestCliVersion;
    latestSdkVersion = fetchedSdkVersion ?? cached?.latestSdkVersion;

    if ((latestCliVersion || latestSdkVersion) && cacheDir) {
      await writeCache(
        cacheDir,
        { latestCliVersion, latestSdkVersion },
        {
          mkdir: deps.mkdir ?? mkdir,
          now,
          writeFile: deps.writeFile ?? writeFile,
        },
      );
    }
  }

  const updates: PackageUpdate[] = [];
  if (
    latestCliVersion &&
    compareVersions(latestCliVersion, packageJson.version) > 0
  ) {
    updates.push({
      currentVersion: packageJson.version,
      latestVersion: latestCliVersion,
      packageName: CLI_PACKAGE_NAME,
    });
  }

  const currentSdkVersion =
    deps.currentSdkVersion ?? (await detectInstalledSdkVersion());
  if (
    currentSdkVersion &&
    latestSdkVersion &&
    compareVersions(latestSdkVersion, currentSdkVersion) > 0
  ) {
    updates.push({
      currentVersion: currentSdkVersion,
      latestVersion: latestSdkVersion,
      packageName: SDK_PACKAGE_NAME,
    });
  }

  if (updates.length) {
    stderr.write(`${formatUpdateNotice(updates)}\n`);
  }
}
