import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { fileKind, type VaultFile } from "../files.js";

/**
 * Reads the fixture vault from disk. A live vault is never read: the fixture is
 * the only vault the suite knows, so a change to the mapping is a change to the
 * fixture and its assertions in the same commit.
 */

export const FIXTURE_ROOT = fileURLToPath(new URL("../../fixtures/vault", import.meta.url));

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else found.push(path);
  }
  return found;
}

/** The fixture vault as the importer receives it: paths and text, no bytes. */
export function readFixtureVault(): VaultFile[] {
  return walk(FIXTURE_ROOT)
    .map((path) => {
      const relativePath = relative(FIXTURE_ROOT, path).split(sep).join("/");
      const kind = fileKind({ path: relativePath });
      const file: VaultFile = { path: relativePath, byteLength: statSync(path).size };
      if (kind === "note" || kind === "canvas") file.text = readFileSync(path, "utf8");
      return file;
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The text of one fixture file, for a test that needs the raw Markdown. */
export function fixtureText(path: string): string {
  return readFileSync(join(FIXTURE_ROOT, path), "utf8");
}
