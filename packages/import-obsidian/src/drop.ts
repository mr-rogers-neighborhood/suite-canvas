import { fileKind, type VaultFile } from "./files.js";

/**
 * Owns turning a dropped folder into the file list the importer takes.
 *
 * The shape is structural rather than the browser's own: `FileSystemEntry` and
 * `File` are what a drop hands over, and both match these interfaces, so the walk
 * is testable with plain objects and the launcher never writes it.
 */

export interface DroppedFileLike {
  name: string;
  size: number;
  text: () => Promise<string>;
}

export interface DroppedReaderLike {
  readEntries: (
    onEntries: (entries: DroppedEntryLike[]) => void,
    onError?: (error: unknown) => void,
  ) => void;
}

export interface DroppedEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (onFile: (file: DroppedFileLike) => void, onError?: (error: unknown) => void) => void;
  createReader?: () => DroppedReaderLike;
}

export interface CollectVaultOptions {
  /** Biggest file read as text. A larger note is reported, never truncated. Default 8 MiB. */
  maxBytes?: number;
}

export interface CollectedVault {
  files: VaultFile[];
  /** Files or folders the walk could not read, with the reason. */
  skipped: Array<{ path: string; reason: string }>;
}

export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function callFile(entry: DroppedEntryLike): Promise<DroppedFileLike> {
  return new Promise((resolve, reject) => {
    if (!entry.file) {
      reject(new Error("This entry has no file handle."));
      return;
    }
    entry.file(resolve, reject);
  });
}

/** Every entry of a directory; the API reports them in batches. */
async function readEntries(entry: DroppedEntryLike): Promise<DroppedEntryLike[]> {
  const reader = entry.createReader?.();
  if (!reader) throw new Error("This folder cannot be read.");
  const all: DroppedEntryLike[] = [];
  for (;;) {
    const batch = await new Promise<DroppedEntryLike[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walk(
  entry: DroppedEntryLike,
  prefix: string,
  maxBytes: number,
  out: CollectedVault,
): Promise<void> {
  const path = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isDirectory) {
    let children: DroppedEntryLike[];
    try {
      children = await readEntries(entry);
    } catch (error) {
      out.skipped.push({
        path,
        reason: `The folder could not be read (${error instanceof Error ? error.message : String(error)}).`,
      });
      return;
    }
    for (const child of children) await walk(child, path, maxBytes, out);
    return;
  }
  if (!entry.isFile) {
    out.skipped.push({ path, reason: "This entry is neither a file nor a folder." });
    return;
  }

  const kind = fileKind({ path });
  let file: DroppedFileLike;
  try {
    file = await callFile(entry);
  } catch (error) {
    out.skipped.push({
      path,
      reason: `The file could not be read (${error instanceof Error ? error.message : String(error)}).`,
    });
    return;
  }

  if (kind === "note" || kind === "canvas") {
    if (file.size > maxBytes) {
      out.skipped.push({
        path,
        reason: `The file is ${file.size} bytes, larger than the ${maxBytes}-byte limit for a note.`,
      });
      return;
    }
    const text = await file.text();
    out.files.push({ path, text, byteLength: file.size });
    return;
  }
  // An attachment's bytes are not imported; its size is all the report needs.
  out.files.push({ path, byteLength: file.size });
}

/**
 * Reads a dropped folder into the importer's input. The root entry's own name is
 * not part of any path, so the vault's folders are what the boards are named for.
 */
export async function collectVaultFiles(
  entries: ReadonlyArray<DroppedEntryLike | null | undefined>,
  options: CollectVaultOptions = {},
): Promise<CollectedVault> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const out: CollectedVault = { files: [], skipped: [] };
  for (const entry of entries) {
    // `webkitGetAsEntry()` returns null for a drop that carried no file.
    if (!entry) continue;
    if (entry.isDirectory) {
      let children: DroppedEntryLike[];
      try {
        children = await readEntries(entry);
      } catch (error) {
        out.skipped.push({
          path: entry.name,
          reason: `The folder could not be read (${error instanceof Error ? error.message : String(error)}).`,
        });
        continue;
      }
      for (const child of children) await walk(child, "", maxBytes, out);
      continue;
    }
    await walk(entry, "", maxBytes, out);
  }
  out.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}
