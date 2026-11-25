import process from "node:process";

import { runCli } from "./run";
import { startUpdateCheck } from "./update-check";

async function main(): Promise<void> {
  const pendingNotice = process.argv.includes("--quiet")
    ? Promise.resolve(undefined)
    : startUpdateCheck();
  process.exitCode = await runCli(process.argv);
  const notice = await pendingNotice;
  if (notice) {
    process.stderr.write(`${notice}\n`);
  }
}

void main();
