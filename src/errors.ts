import chalk from "chalk";
import { CommanderError } from "commander";
import {
  PawPlacerApiError,
  PawPlacerResponseValidationError,
} from "pawplacer-sdk";

export const EXIT_CODES = {
  ok: 0,
  error: 1,
  usage: 2,
  cancelled: 130,
} as const;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const API_ERROR_HINTS: Record<string, string> = {
  api_key_required:
    "Set PAWPLACER_API_KEY or pass --api-key. Create a key in PawPlacer under Settings > SDK/API.",
  invalid_api_key:
    "Check that you copied the whole key and that it hasn't been revoked in Settings > SDK/API.",
  insufficient_scope:
    "This key is read-only. Create a Write + read key in Settings > SDK/API for create and update commands.",
  rate_limited:
    "Wait for the rate-limit window to reset; run `pawplacer doctor` to see the current allowance.",
};

function isPromptCancel(error: unknown): boolean {
  return error instanceof Error && error.name === "ExitPromptError";
}

function isNetworkError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "NetworkError" ||
      (error instanceof TypeError && error.message === "fetch failed"))
  );
}

export function exitCodeFor(error: unknown): number {
  if (isPromptCancel(error)) {
    return EXIT_CODES.cancelled;
  }
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? EXIT_CODES.ok : EXIT_CODES.usage;
  }
  if (error instanceof CliUsageError) {
    return EXIT_CODES.usage;
  }
  return EXIT_CODES.error;
}

function formatDetails(details: unknown): string[] {
  if (details === undefined || details === null) {
    return [];
  }
  if (Array.isArray(details)) {
    return details.map((item) =>
      typeof item === "string" ? `  - ${item}` : `  - ${JSON.stringify(item)}`,
    );
  }
  if (typeof details === "object") {
    return Object.entries(details as Record<string, unknown>).map(
      ([field, problem]) =>
        `  - ${field}: ${typeof problem === "string" ? problem : JSON.stringify(problem)}`,
    );
  }
  return [`  - ${String(details)}`];
}

function formatApiError(error: PawPlacerApiError): string {
  const hint =
    typeof error.apiError.hint === "string"
      ? error.apiError.hint
      : API_ERROR_HINTS[error.code];
  const lines = [
    `${chalk.red(`API error ${error.status}`)} ${chalk.yellow(`[${error.code}]`)} ${error.message}`,
    ...formatDetails(error.apiError.details ?? error.apiError.errors),
  ];
  if (hint) {
    lines.push(chalk.gray(`Hint: ${hint}`));
  }
  if (error.requestId && error.requestId !== "unknown") {
    lines.push(chalk.gray(`Request ID: ${error.requestId}`));
  }
  return lines.join("\n");
}

export function formatError(
  error: unknown,
  options: { apiUrl?: string; debug?: boolean } = {},
): string | undefined {
  if (isPromptCancel(error)) {
    return chalk.gray("Cancelled.");
  }
  if (error instanceof CommanderError) {
    return undefined;
  }

  let message: string;
  if (error instanceof PawPlacerApiError) {
    message = formatApiError(error);
  } else if (error instanceof PawPlacerResponseValidationError) {
    message = `${chalk.red("Unexpected API response")}: ${error.message}`;
  } else if (isNetworkError(error)) {
    const target = options.apiUrl ?? "the PawPlacer API";
    message = `${chalk.red(`Could not reach ${target}`)}: ${error.message}\n${chalk.gray(
      "Hint: check your connection, or --api-url / PAWPLACER_API_URL if you set one.",
    )}`;
  } else if (error instanceof Error) {
    message = chalk.red(error.message);
  } else {
    message = chalk.red(String(error));
  }

  if (options.debug && error instanceof Error && error.stack) {
    message += `\n${chalk.gray(error.stack)}`;
  }
  return message;
}
