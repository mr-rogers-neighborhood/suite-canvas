import { WorkspaceDocument } from "@suite/graph";
import {
  collectVaultFiles,
  type DroppedEntryLike,
  fileKind,
  type ImportReport,
  importObsidianVault,
  reportSummary,
  type VaultFile,
} from "@suite/import-obsidian";
import { LoroDoc } from "loro-crdt";
import { LoroIndexeddbPersistence } from "../collab/loroPersistence";

/**
 * Owns the launcher's Obsidian drop: read the dropped folder, write it into a
 * workspace this browser already holds, and say what happened.
 *
 * The import never creates a workspace. A vault that lands in a new document
 * would look like an import and behave like a new workspace: no name, no other
 * boards, and nothing the reader chose. So a workspace that is not cached on
 * this device is refused by name instead.
 */

export interface VaultImportOutcome {
  /** False means nothing was written; the message says why. */
  ok: boolean;
  /** The headline: what arrived, or what was refused. */
  message: string;
  /** The losses and notes behind it, when there are any. */
  detail?: string | undefined;
  /** The first board the import wrote, so the caller can offer to open it. */
  boardId?: string | undefined;
}

export interface VaultImportArgs {
  /** The workspace the reader dropped onto, or picked from inside. */
  workspaceId: string;
  /** The dropped entries, taken from the event before the first `await`. */
  entries?: ReadonlyArray<DroppedEntryLike | null | undefined>;
  /**
   * The vault already read, for a caller that had a file picker rather than a drop.
   *
   * A tablet cannot drag a folder, so the menu offers one; the picker hands over flat
   * files with relative paths, which is exactly the shape the importer parses.
   */
  files?: readonly VaultFile[];
  /** Names the vault's root board; the folder's name, usually. */
  homeBoardName?: string | undefined;
}

/**
 * What a folder picker handed over, as the importer's own file list.
 *
 * Only notes and canvases are read as text. An attachment is counted and reported, and
 * reading a 40 MB video as a string to throw it away is how an import turns into a crash.
 */
export async function vaultFilesFromPicker(list: FileList): Promise<{
  files: VaultFile[];
  name: string | undefined;
}> {
  const files: VaultFile[] = [];
  let name: string | undefined;
  for (const file of Array.from(list)) {
    // `MyVault/Notes/Alpha.md`: the first segment is the folder they picked, and it is
    // the vault's name rather than part of any path inside it.
    const parts = (file.webkitRelativePath || file.name).split("/");
    if (name === undefined && parts.length > 1) name = parts[0];
    const path = parts.slice(1).join("/");
    if (path.length === 0) continue;
    const kind = fileKind({ path });
    files.push({
      path,
      byteLength: file.size,
      ...(kind === "note" || kind === "canvas" ? { text: await file.text() } : {}),
    });
  }
  return { files, name };
}

/** A short list that never hides a count: `a, b, c (+4 more)`. */
function listNames(items: readonly string[], limit = 3): string {
  const shown = items.slice(0, limit).join(", ");
  return items.length > limit ? `${shown} (+${items.length - limit} more)` : shown;
}

/**
 * One line for the toast's detail: every class of loss the report carries, plus
 * the files the walk itself could not read. An import that quietly dropped a
 * note is the failure the report exists to prevent, so nothing here is optional.
 */
export function lossDetail(
  report: ImportReport,
  unread: readonly { path: string; reason: string }[],
): string | undefined {
  const lines: string[] = [];
  if (report.links.unresolved.length > 0) {
    lines.push(
      `${report.links.unresolved.length} link(s) point at notes the vault did not have: ${listNames(report.links.unresolved)}.`,
    );
  }
  if (report.properties.keptAsText.length > 0) {
    lines.push(
      `${report.properties.keptAsText.length} frontmatter key(s) had no matching field and stay as text: ${listNames(
        report.properties.keptAsText.map((entry) => `${entry.key} in ${entry.path}`),
      )}.`,
    );
  }
  if (report.attachments.length > 0) {
    lines.push(
      `${report.attachments.length} embedded file(s) were not imported: ${listNames(
        report.attachments.map((entry) => entry.path),
      )}.`,
    );
  }
  const skipped = [...report.skipped, ...unread];
  if (skipped.length > 0) {
    lines.push(
      `${skipped.length} file(s) were not read: ${listNames(
        skipped.map((entry) => `${entry.path} (${entry.reason})`),
      )}.`,
    );
  }
  lines.push(...report.notes);
  return lines.length > 0 ? lines.join(" ") : undefined;
}

/** The dropped folder's own name, which is what the home board is called. */
export function vaultName(
  entries: ReadonlyArray<DroppedEntryLike | null | undefined>,
): string | undefined {
  for (const entry of entries) {
    if (entry?.isDirectory && entry.name.trim().length > 0) return entry.name;
  }
  return undefined;
}

/**
 * Reads the drop, then writes it as one change on the workspace's own document.
 *
 * The document is the cached copy this browser would open, so the import lands
 * in the same history the editor shows: one undo takes it back, and the next
 * sync carries it to the relay.
 */
export async function importVaultIntoWorkspace(args: VaultImportArgs): Promise<VaultImportOutcome> {
  const collected =
    args.files === undefined
      ? await collectVaultFiles(args.entries ?? [])
      : { files: [...args.files], skipped: [] };
  if (collected.files.length === 0) {
    return {
      ok: false,
      message: "Nothing was imported: that vault holds no notes or canvases.",
      ...(collected.skipped.length > 0
        ? {
            detail: `${collected.skipped.length} entry(ies) could not be read: ${listNames(
              collected.skipped.map((entry) => `${entry.path} (${entry.reason})`),
            )}.`,
          }
        : {}),
    };
  }

  const doc = new LoroDoc();
  const persistence = new LoroIndexeddbPersistence(args.workspaceId, doc);
  try {
    await persistence.load();
    const workspace = new WorkspaceDocument(doc);
    if (workspace.listBoards().length === 0 && workspace.listCards().length === 0) {
      return {
        ok: false,
        message: "Nothing was imported: this workspace is not stored on this device yet.",
        detail: "Open it from the list once, then drop the vault onto its row again.",
      };
    }

    const result = importObsidianVault(workspace, {
      files: collected.files,
      ...(args.homeBoardName ? { homeBoardName: args.homeBoardName } : {}),
    });
    if (result.isErr()) {
      return { ok: false, message: "Nothing was imported.", detail: result.error.message };
    }

    // The panel and the editor read this copy next, so the import has to be in
    // the store before the toast says it landed.
    await persistence.compact();
    const report = result.value;
    const detail = lossDetail(report, collected.skipped);
    const boardId = report.boards[0]?.id;
    return {
      ok: true,
      message: reportSummary(report),
      ...(detail === undefined ? {} : { detail }),
      ...(boardId === undefined ? {} : { boardId }),
    };
  } catch (cause) {
    return {
      ok: false,
      message: "The import stopped before it finished.",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    persistence.destroy();
  }
}
