import process from "node:process";

import { createProgram, formatError } from "./program";
import { checkForUpdates } from "./update-check";

async function main(): Promise<void> {
  const program = createProgram();
  try {
    await checkForUpdates();
    await program.parseAsync(process.argv);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
