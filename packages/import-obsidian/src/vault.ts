import type { WorkspaceDocument } from "@suite/graph";
import { err, ok, type Result } from "neverthrow";
import { boardForPath, prepareBoards } from "./boards.js";
import { importCanvas } from "./canvases.js";
import type { LinkResolver } from "./convert.js";
import { fileKind, folderOf, isVaultInternal, type VaultFile } from "./files.js";
import { VaultIndex } from "./lookup.js";
import { createNoteCard, finishNote, type PendingNote } from "./notes.js";
import { type ImportFailure, type ImportReport, newImportReport } from "./report.js";

/**
 * Owns the import as a whole: reading the vault once, writing every record
 * through the typed document methods, and returning what it could not carry.
 *
 * The whole import is one batch, so it lands as one change: a single undo takes
 * the imported workspace back to what it was.
 */

/** Origin the import commits under, which is what the history panel shows. */
export const IMPORT_ORIGIN = "obsidian:vault";

/** The type a note lands on when its frontmatter names none. */
export const DEFAULT_NOTE_TYPE_ID = "note";

export interface ImportObsidianOptions {
  /** Every file the caller read, with its text where the importer parses it. */
  files: readonly VaultFile[];
  /** Names the vault root's board, usually after the folder that was dropped. */
  homeBoardName?: string | undefined;
  /** Frontmatter key to field id, for a key whose name matches no field. */
  fieldByKey?: Readonly<Record<string, string>> | undefined;
  /** Card type id for a note whose frontmatter names no type. */
  defaultTypeId?: string | undefined;
}

/** The card a `card`-kind property value names, through the same link index. */
function propertyCardResolver(
  index: VaultIndex,
  folder: string,
): (target: string) => string | null {
  return (target) => index.resolve(target, folder).cardId;
}

export function importObsidianVault(
  workspace: WorkspaceDocument,
  options: ImportObsidianOptions,
): Result<ImportReport, ImportFailure> {
  const files = options.files;
  if (files.length === 0) {
    return err({ kind: "no-files", message: "The dropped folder holds no files." });
  }

  const report = newImportReport();
  report.files.total = files.length;
  const tagIds = new Set<string>();
  const tagId = (name: string): string => {
    const tag = workspace.ensureTag(name);
    if (!tagIds.has(tag.id)) {
      tagIds.add(tag.id);
      report.records.tags += 1;
    }
    return tag.id;
  };

  try {
    workspace.batch(IMPORT_ORIGIN, () => {
      const notes: VaultFile[] = [];
      const canvases: VaultFile[] = [];
      for (const file of [...files].sort((a, b) =>
        a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
      )) {
        if (isVaultInternal(file.path)) {
          report.files.skipped += 1;
          report.skipped.push({
            path: file.path,
            reason: "Obsidian's own settings folder is not imported.",
          });
          continue;
        }
        switch (fileKind(file)) {
          case "note":
            notes.push(file);
            break;
          case "canvas":
            canvases.push(file);
            break;
          case "attachment":
            report.files.attachments += 1;
            break;
          default:
            report.files.skipped += 1;
            report.skipped.push({
              path: file.path,
              reason:
                "This file type is not a note, a canvas or an attachment, so it was not read.",
            });
        }
      }

      const folders = [...new Set(notes.map((note) => folderOf(note.path)))];
      const plan = prepareBoards(workspace, folders, {
        homeBoardName: options.homeBoardName,
        report,
      });

      const index = new VaultIndex();
      const pending: PendingNote[] = [];
      const slots = new Map<string, number>();
      const defaultTypeId = options.defaultTypeId ?? DEFAULT_NOTE_TYPE_ID;

      for (const note of notes) {
        if (note.text === undefined) {
          report.files.skipped += 1;
          report.skipped.push({ path: note.path, reason: "The note's text was not provided." });
          continue;
        }
        const boardId = boardForPath(plan, folderOf(note.path));
        const slot = slots.get(boardId) ?? 0;
        slots.set(boardId, slot + 1);
        const created = createNoteCard({
          workspace,
          path: note.path,
          text: note.text,
          boardId,
          slot,
          defaultTypeId,
          tagId,
        });
        pending.push(created);
        index.add(note.path, created.cardId);
        report.files.notes += 1;
        report.records.cards += 1;
      }

      for (const note of pending) {
        const resolve = (target: string) => index.resolve(target, note.folder);
        const resolver: LinkResolver = {
          resolve: (target: string) => {
            const found = resolve(target);
            return { cardId: found.cardId, ambiguous: found.ambiguous };
          },
        };
        const resolveCard = propertyCardResolver(index, note.folder);
        finishNote({
          workspace,
          note,
          resolve: resolver,
          fieldByKey: options.fieldByKey,
          resolveCard,
          report,
        });
      }

      for (const canvas of canvases) {
        if (canvas.text === undefined) {
          report.files.skipped += 1;
          report.skipped.push({
            path: canvas.path,
            reason: "The canvas's text was not provided.",
          });
          continue;
        }
        const folder = folderOf(canvas.path);
        const resolver: LinkResolver = {
          resolve: (target: string) => {
            const found = index.resolve(target, folder);
            return { cardId: found.cardId, ambiguous: found.ambiguous };
          },
        };
        const result = importCanvas({
          workspace,
          path: canvas.path,
          text: canvas.text,
          resolve: resolver,
          index,
          defaultTypeId,
          report,
        });
        if (result) report.records.cards += result.cardIds.length;
        report.records.sections += result?.sectionIds.length ?? 0;
      }
    });
  } catch (error) {
    return err({
      kind: "write-failed",
      message: `The workspace refused a write during the import (${error instanceof Error ? error.message : String(error)}).`,
    });
  }

  // A board with nothing on it is a folder whose notes all failed; say so rather
  // than leaving a reader to wonder why the board is empty.
  for (const board of workspace.listBoards()) {
    if (workspace.listBoardCards(board.id).length === 0) {
      report.notes.push(`The board "${board.name}" has no cards.`);
    }
  }
  return ok(report);
}
