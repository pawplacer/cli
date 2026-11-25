import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import chalk from "chalk";

import packageJson from "../package.json";

export interface UpdateCheckDeps {
  cacheDir?: string;
  cacheTtlMs?: number;
  currentVersion?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  mkdir?: typeof mkdir;
  now?: () => number;
  readFile?: typeof readFile;
  stderrIsTTY?: boolean;
  timeoutMs?: number;
  writeFile?: typeof writeFile;
}

interface UpdateCache {
  checkedAt: number;
  latestVersion: string;
  schemaVersion: number;
}

const LATEST_URL = "https://registry.npmjs.org/pawplacer-cli/latest";
const UPDATE_COMMAND = "npm install -g pawplacer-cli@latest";
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 1000;
const CACHE_SCHEMA_VERSION = 3;

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

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes(value?.toLowerCase() ?? "");
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
    const value = JSON.parse(contents) as Partial<UpdateCache> | null;
    return value?.schemaVersion === CACHE_SCHEMA_VERSION &&
      typeof value.checkedAt === "number" &&
      typeof value.latestVersion === "string"
      ? (value as UpdateCache)
      : undefined;
  } catch {
    return undefined;
  }
}

async function fetchLatestVersion(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | undefined> {
  const response = await fetchImpl(LATEST_URL, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    return undefined;
  }
  const body = (await response.json()) as { version?: unknown } | null;
  return typeof body?.version === "string" ? body.version : undefined;
}

export function formatUpdateNotice(current: string, latest: string): string {
  const rows = [
    { raw: "Update available", styled: chalk.bold("Update available") },
    {
      raw: `pawplacer-cli ${current} -> ${latest}`,
      styled: chalk.gray(`pawplacer-cli ${current} -> ${latest}`),
    },
    {
      raw: `Run ${UPDATE_COMMAND}`,
      styled: `Run ${chalk.cyan(UPDATE_COMMAND)}`,
    },
  ];
  const width = Math.max(...rows.map((row) => row.raw.length));
  const horizontal = "─".repeat(width + 2);
  return [
    chalk.yellow(`┌${horizontal}┐`),
    ...rows.map(
      (row) =>
        `${chalk.yellow("│")} ${row.styled}${" ".repeat(width - row.raw.length)} ${chalk.yellow("│")}`,
    ),
    chalk.yellow(`└${horizontal}┘`),
  ].join("\n");
}

async function latestVersion(deps: UpdateCheckDeps, env: NodeJS.ProcessEnv) {
  const now = deps.now ?? Date.now;
  const cacheDir = deps.cacheDir ?? defaultCacheDir(env);
  const cachePath = cacheDir ? join(cacheDir, "update-check.json") : undefined;
  const cached = cachePath
    ? await (deps.readFile ?? readFile)(cachePath, "utf8")
        .then(parseCache)
        .catch(() => undefined)
    : undefined;
  if (
    cached &&
    now() - cached.checkedAt < (deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS)
  ) {
    return cached.latestVersion;
  }

  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const fetched = await fetchLatestVersion(
    fetchImpl,
    deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  ).catch(() => undefined);
  if (fetched && cacheDir && cachePath) {
    await (deps.mkdir ?? mkdir)(cacheDir, { recursive: true })
      .then(() =>
        (deps.writeFile ?? writeFile)(
          cachePath,
          `${JSON.stringify({
            checkedAt: now(),
            latestVersion: fetched,
            schemaVersion: CACHE_SCHEMA_VERSION,
          } satisfies UpdateCache)}\n`,
          "utf8",
        ),
      )
      .catch(() => undefined);
  }
  return fetched ?? cached?.latestVersion;
}

export async function startUpdateCheck(
  deps: UpdateCheckDeps = {},
): Promise<string | undefined> {
  const env = deps.env ?? process.env;
  const stderrIsTTY = deps.stderrIsTTY ?? process.stderr.isTTY === true;
  if (isTruthy(env.PAWPLACER_NO_UPDATE_CHECK) || env.CI || !stderrIsTTY) {
    return undefined;
  }
  try {
    const latest = await latestVersion(deps, env);
    const current = deps.currentVersion ?? packageJson.version;
    return latest && compareVersions(latest, current) > 0
      ? formatUpdateNotice(current, latest)
      : undefined;
  } catch {
    return undefined;
  }
}
