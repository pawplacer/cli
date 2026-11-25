import process from "node:process";

import { exitCodeFor, formatError } from "./errors";
import type { Writable } from "./output";
import { DEFAULT_API_URL, type ProgramDeps, runProgram } from "./program";

function flagValue(argv: string[], flag: string): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) {
    return inline.slice(flag.length + 1);
  }
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export async function runCli(
  argv: string[],
  deps: ProgramDeps = {},
): Promise<number> {
  const stderr: Writable = deps.stderr ?? process.stderr;
  const env = deps.env ?? process.env;
  try {
    await runProgram(argv, deps);
    return 0;
  } catch (error) {
    const message = formatError(error, {
      apiUrl:
        flagValue(argv, "--api-url") ??
        env.PAWPLACER_API_URL ??
        DEFAULT_API_URL,
      debug: argv.includes("--debug"),
    });
    if (message) {
      stderr.write(`${message}\n`);
    }
    return exitCodeFor(error);
  }
}
