import { fileKind, type VaultFile } from "@suite/import-obsidian";
import { readZipEntries } from "../archive/zip";

/**
 * Owns a vault that arrives zipped.
 *
 * A folder picker is the pleasant path, and it is not one every device offers: a
 * tablet's Files app hands over a single file, so a vault somebody zipped is the only
 * shape they can choose. Reading a zip needs an inflate step, and every browser this
 * ships to has one — `DecompressionStream("deflate-raw")` is the raw DEFLATE that zip
 * stores — so this is a reader rather than a dependency.
 *
 * Only what a vault is gets read: notes and canvases as text, attachments by path and
 * size, the way `collectVaultFiles` reports a drop. Anything the archive could not be
 * read from is named, because an import that quietly loses a note is the failure the
 * report exists to prevent.
 *
 * The archive itself is `archive/zip.ts`, which the EPUB reader also uses: a vault and a
 * book are the same container, and reading one twice would be two answers to one format.
 */

/** Archive bookkeeping, never vault content. */
function isNoise(path: string): boolean {
  if (path.length === 0) return true;
  if (path.startsWith("__MACOSX/")) return true;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === ".DS_Store" || name.length === 0;
}

export interface VaultZip {
  files: VaultFile[];
  /** The archive's own name, minus `.zip`, which is what the vault's board is called. */
  name: string;
}

const decoder = new TextDecoder();

/**
 * Read a zipped vault into the importer's file list.
 *
 * Throws when the archive cannot be read at all; a single unreadable entry is reported
 * in the returned files' absence rather than thrown, because one bad byte in a photograph
 * must not cost the reader their notes.
 */
export async function readVaultZip(bytes: Uint8Array, archiveName: string): Promise<VaultZip> {
  const files: VaultFile[] = [];
  for (const entry of readZipEntries(bytes)) {
    if (isNoise(entry.path)) continue;
    const kind = fileKind({ path: entry.path });
    if (kind === "note" || kind === "canvas") {
      try {
        files.push({ path: entry.path, text: decoder.decode(await entry.read()) });
      } catch {
        // Named by its absence: the importer reports what it did not get.
      }
    } else {
      // An attachment's bytes are never parsed, so its size is all that is read.
      files.push({ path: entry.path, byteLength: entry.size });
    }
  }

  const name = archiveName.replace(/\.zip$/iu, "");
  return { files, name };
}
