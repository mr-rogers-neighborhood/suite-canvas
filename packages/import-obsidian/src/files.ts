/**
 * Owns the vault as the importer receives it: a flat list of paths and text, with
 * no file system and no DOM. A caller that reads a dropped folder hands the same
 * shape in, which is what keeps the importer testable against a fixture.
 */

/** One file of a vault, keyed by its path inside the vault. */
export interface VaultFile {
  /** POSIX path relative to the vault root, for example `Projects/Alpha.md`. */
  path: string;
  /** The file's text, for the files the importer parses. Absent for a binary. */
  text?: string;
  /** Size in bytes, when the caller knows it. Reported, never read. */
  byteLength?: number;
}

export const NOTE_EXTENSION = ".md";
export const CANVAS_EXTENSION = ".canvas";

export type VaultFileKind = "note" | "canvas" | "attachment" | "other";

/**
 * Extensions that are attachments rather than notes. The importer never reads
 * their bytes; a reference to one stays as text and is reported.
 */
export const ATTACHMENT_EXTENSIONS: readonly string[] = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".bmp",
  ".heic",
  ".pdf",
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  ".mp4",
  ".mov",
  ".webm",
  ".zip",
  ".docx",
  ".xlsx",
  ".pptx",
  ".epub",
];

/** Obsidian's own settings folder; importing it would create boards nobody wants. */
export const VAULT_INTERNAL_FOLDER = ".obsidian";

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLocaleLowerCase();
}

export function fileKind(file: VaultFile): VaultFileKind {
  const extension = extensionOf(file.path);
  if (extension === NOTE_EXTENSION) return "note";
  if (extension === CANVAS_EXTENSION) return "canvas";
  if (ATTACHMENT_EXTENSIONS.includes(extension)) return "attachment";
  return "other";
}

/** The folder a path sits in, `""` for the vault root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** The last segment of a path. */
export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The file name without its extension. */
export function stemOf(path: string): string {
  const base = baseName(path);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? base : base.slice(0, dot);
}

/** True for a file or folder inside Obsidian's settings folder. */
export function isVaultInternal(path: string): boolean {
  return path.split("/").some((segment) => segment === VAULT_INTERNAL_FOLDER);
}

/** Path segments of a folder, outermost first. `""` yields no segments. */
export function folderSegments(folder: string): string[] {
  return folder.split("/").filter((segment) => segment.length > 0);
}

/**
 * The board a folder becomes. The whole relative path is the name, so a nested
 * hierarchy stays visible instead of two `Notes` folders collapsing into one.
 */
export function boardNameForFolder(folder: string): string {
  return folderSegments(folder).join(" / ");
}
