import { CliUsageError } from "./errors";

export interface PayloadOptions {
  data?: string;
  file?: string;
  prompt?: boolean;
}

export interface PayloadDeps {
  interactive: boolean;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  readStdin: () => Promise<string>;
}

export function parseJsonObject(
  source: string,
  label: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new CliUsageError(`${label} must contain valid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliUsageError(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function readStdinObject(deps: PayloadDeps) {
  const source = await deps.readStdin();
  if (!source.trim()) {
    throw new CliUsageError(
      "No payload given. Pass --data '<json>', --file <path>, or --prompt.",
    );
  }
  return parseJsonObject(source, "stdin");
}

export async function readPayload(
  options: PayloadOptions,
  deps: PayloadDeps,
  prompt: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const sources = [
    options.data !== undefined,
    options.file !== undefined,
    options.prompt === true,
  ].filter(Boolean).length;

  if (sources > 1) {
    throw new CliUsageError("Use only one of --data, --file, or --prompt.");
  }
  if (options.data !== undefined) {
    return parseJsonObject(options.data, "--data");
  }
  if (options.file === "-") {
    return readStdinObject(deps);
  }
  if (options.file !== undefined) {
    return parseJsonObject(
      await deps.readFile(options.file, "utf8"),
      options.file,
    );
  }
  if (options.prompt && !deps.interactive) {
    throw new CliUsageError("--prompt needs an interactive terminal.");
  }
  if (options.prompt || deps.interactive) {
    return prompt();
  }
  return readStdinObject(deps);
}
