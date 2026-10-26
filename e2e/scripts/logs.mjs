#!/usr/bin/env node
/** Prints the tail of each captured e2e server log. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = path.join(E2E_DIR, ".artifacts");
const lines = Number(process.argv[2] ?? 80);

let files;
try {
  files = readdirSync(LOG_DIR)
    .filter((file) => file.endsWith(".log"))
    .sort();
} catch {
  console.error(`No e2e logs yet. Run an e2e command first; it writes to ${LOG_DIR}.`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`No e2e logs in ${LOG_DIR}.`);
  process.exit(1);
}

for (const file of files) {
  const content = readFileSync(path.join(LOG_DIR, file), "utf8").trimEnd().split("\n");
  console.log(`\n=== ${file} (last ${lines} lines) ===`);
  console.log(content.slice(-lines).join("\n"));
}
