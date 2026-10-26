/**
 * `@suite/import-obsidian` reads an Obsidian vault into a Suite workspace.
 *
 * The entry point is `importObsidianVault`: it takes the files of a dropped
 * folder, writes them through `@suite/graph`'s typed document methods, and
 * returns a `Result` whose success value is the fidelity summary. Nothing is
 * dropped without a row in that summary.
 *
 * The mapping from vault concepts to workspace records is data in `mapping.ts`,
 * so what the import can and cannot carry is reviewable without reading the
 * writer.
 */

export { gridPosition, NOTE_GRID } from "./boards.js";
export type { CanvasEdge, CanvasNode } from "./canvas.js";
export { parseCanvas } from "./canvas.js";
export type {
  CollectedVault,
  CollectVaultOptions,
  DroppedEntryLike,
  DroppedFileLike,
} from "./drop.js";
export { collectVaultFiles, DEFAULT_MAX_BYTES } from "./drop.js";
export type { VaultFile, VaultFileKind } from "./files.js";
export {
  ATTACHMENT_EXTENSIONS,
  baseName,
  boardNameForFolder,
  CANVAS_EXTENSION,
  extensionOf,
  fileKind,
  folderOf,
  isVaultInternal,
  NOTE_EXTENSION,
  stemOf,
} from "./files.js";
export type { MappingRow } from "./mapping.js";
export {
  CANVAS_COLOUR_MAP,
  canvasColour,
  mappingTableMarkdown,
  VAULT_MAPPING,
} from "./mapping.js";
export type { BlockToken, InlineToken, ParsedNote } from "./markdown.js";
export { parseInline, parseMarkdown } from "./markdown.js";
export type { ImportFailure, ImportReport } from "./report.js";
export { newImportReport, reportSummary } from "./report.js";
export type { ImportObsidianOptions } from "./vault.js";
export { DEFAULT_NOTE_TYPE_ID, IMPORT_ORIGIN, importObsidianVault } from "./vault.js";
