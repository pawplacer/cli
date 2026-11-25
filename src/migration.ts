import { CliUsageError } from "./errors";

const REMOVED_FLAGS: Record<string, string> = {
  "--stdin": "Pipe JSON in, or pass --file -.",
  "--no-cache": "The CLI always reads fresh data now; drop the flag.",
  "--force-refresh": "The CLI always reads fresh data now; drop the flag.",
  "--retry":
    "Writes with an idempotency key retry automatically now; drop the flag.",
  "--no-auto-idempotency-key": "Use --no-idempotency-key.",
  "--updated-since": "Use --since.",
};

function removedCommandHint(argv: string[]): string | undefined {
  const petsIndex = argv.indexOf("pets");
  if (petsIndex === -1) {
    return undefined;
  }
  const command = argv.slice(petsIndex + 1).find((arg) => !arg.startsWith("-"));
  if (command === "search") {
    return "`pets search` was removed in 2.0. Use `pawplacer pets list --search <query>`.";
  }
  if (command === "status") {
    return "`pets status` was removed in 2.0. Use `pawplacer pets list --status <status>`.";
  }
  return undefined;
}

export function assertNoRemovedUsage(argv: string[]): void {
  const commandHint = removedCommandHint(argv);
  if (commandHint) {
    throw new CliUsageError(commandHint);
  }

  for (const [index, arg] of argv.entries()) {
    const flag = arg.split("=")[0] ?? arg;
    const hint = REMOVED_FLAGS[flag];
    if (hint) {
      throw new CliUsageError(`${flag} was removed in 2.0. ${hint}`);
    }
    const next = arg.includes("=")
      ? arg.slice(arg.indexOf("=") + 1)
      : argv[index + 1];
    if (flag === "--json" && next?.trim().startsWith("{")) {
      throw new CliUsageError(
        "--json now switches output to JSON. Pass inline payloads with --data '<json>'.",
      );
    }
  }
}
