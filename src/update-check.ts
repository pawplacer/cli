import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import chalk from "chalk";

import packageJson from "../package.json";

type Writable = Pick<NodeJS.WriteStream, "write">;

interface UpdateCache {
  checkedAt?: number;
  latestVersion?: string;
}

export interface UpdateCheckDeps {
  cacheDir?: string;
  cacheTtlMs?: number;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  mkdir?: typeof mkdir;
  now?: () => number;
  readFile?: typeof readFile;
  stderr?: Writable;
  timeoutMs?: number;
  writeFile?: typeof writeFile;
}

const NPM_LATEST_URL = "https://registry.npmjs.org/pawplacer-cli/latest";
const DEFAULT_CACHE_TTL_MS = 48 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 750;

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
    const diff = parsedLeft[index]! - parsedRight[index]!;
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
    return {
      checkedAt:
        typeof cache.checkedAt === "number" ? cache.checkedAt : undefined,
      latestVersion:
        typeof cache.latestVersion === "string"
          ? cache.latestVersion
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
  latestVersion: string,
  deps: Required<Pick<UpdateCheckDeps, "mkdir" | "now" | "writeFile">>,
): Promise<void> {
  try {
    await deps.mkdir(cacheDir, { recursive: true });
    await deps.writeFile(
      join(cacheDir, "update-check.json"),
      `${JSON.stringify({ checkedAt: deps.now(), latestVersion })}\n`,
      "utf8",
    );
  } catch {
    // Update checks should never make the CLI command itself fail.
  }
}

async function fetchLatestVersion(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    const response = await fetchImpl(NPM_LATEST_URL, {
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

function formatUpdateNotice(currentVersion: string, latestVersion: string): string {
  return [
    chalk.yellow(
      `A new pawplacer-cli version is available: ${currentVersion} -> ${latestVersion}.`,
    ),
    `Run ${chalk.cyan("npm install -g pawplacer-cli@latest")} and restart pawplacer.`,
  ].join(" ");
}

export async function checkForUpdates(deps: UpdateCheckDeps = {}): Promise<void> {
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

  let latestVersion: string | undefined;
  if (
    cached?.latestVersion &&
    typeof cached.checkedAt === "number" &&
    now() - cached.checkedAt < cacheTtlMs
  ) {
    latestVersion = cached.latestVersion;
  } else {
    try {
      latestVersion =
        (await fetchLatestVersion(fetchImpl, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)) ??
        cached?.latestVersion;
    } catch {
      latestVersion = cached?.latestVersion;
    }

    if (latestVersion && cacheDir) {
      await writeCache(cacheDir, latestVersion, {
        mkdir: deps.mkdir ?? mkdir,
        now,
        writeFile: deps.writeFile ?? writeFile,
      });
    }
  }

  if (latestVersion && compareVersions(latestVersion, packageJson.version) > 0) {
    stderr.write(`${formatUpdateNotice(packageJson.version, latestVersion)}\n`);
  }
}
