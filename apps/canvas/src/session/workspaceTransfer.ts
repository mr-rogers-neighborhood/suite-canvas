import {
  createWorkspaceFile,
  damagedAttachmentWarning,
  documentAttachments,
  exportPortable,
  readWorkspaceFile,
  WorkspaceDocument,
} from "@suite/graph";

export { type CardAttachment, documentAttachments } from "@suite/graph";

import { LoroDoc } from "loro-crdt";
import { LoroIndexeddbPersistence } from "../collab/loroPersistence";
import { storeLocalAttachment } from "../editor/attachmentNode";
import {
  type AttachmentSource,
  defaultAttachmentSources,
  resolveAttachmentBytes,
} from "./attachmentBytes";

const RECENT_KEY = "suite.recentWorkspaces.v1";
const RECENT_LIMIT = 12;

export interface RecentWorkspace {
  id: string;
  title: string;
  boardId?: string;
  lastOpenedAt: number;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/** Recent workspaces are UI metadata, never document truth. */
export function readRecentWorkspaces(): RecentWorkspace[] {
  if (!hasStorage()) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap((entry): RecentWorkspace[] => {
        if (!entry || typeof entry !== "object") return [];
        const value = entry as Record<string, unknown>;
        if (typeof value.id !== "string" || value.id.length === 0) return [];
        if (typeof value.title !== "string") return [];
        if (typeof value.lastOpenedAt !== "number") return [];
        const boardId = typeof value.boardId === "string" ? value.boardId : undefined;
        return [
          {
            id: value.id,
            title: value.title,
            lastOpenedAt: value.lastOpenedAt,
            ...(boardId ? { boardId } : {}),
          },
        ];
      })
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

export function rememberWorkspace(input: {
  id: string;
  title?: string | undefined;
  boardId?: string | null | undefined;
}): void {
  if (!hasStorage()) return;
  const existing = readRecentWorkspaces();
  const previous = existing.find((entry) => entry.id === input.id);
  const entry: RecentWorkspace = {
    id: input.id,
    title: input.title?.trim() || previous?.title || "Untitled workspace",
    lastOpenedAt: Date.now(),
    ...(input.boardId
      ? { boardId: input.boardId }
      : previous?.boardId
        ? { boardId: previous.boardId }
        : {}),
  };
  const next = [entry, ...existing.filter((item) => item.id !== input.id)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled localStorage must not break opening a workspace.
  }
}

export function forgetWorkspace(id: string): void {
  if (!hasStorage()) return;
  const next = readRecentWorkspaces().filter((entry) => entry.id !== id);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota/availability failures: the list is convenience only.
  }
}

/**
 * The editor URL for a workspace. It carries ids and nothing else: the
 * credential is the session cookie plus the token minted from it, so no secret
 * has to survive a copy-paste, a bookmark or a referrer.
 */
export function workspaceUrl(workspaceId: string, boardId?: string | null): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("workspace", workspaceId);
  if (boardId) url.searchParams.set("board", boardId);
  // A fragment left over from the page that made the link must not travel.
  url.hash = "";
  return url.toString();
}

export function newWorkspaceId(): string {
  return crypto.randomUUID();
}

/** One navigation seam so a screen can be tested without a real reload. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}

export function openWorkspace(id: string, boardId?: string | null): void {
  rememberWorkspace({ id, ...(boardId ? { boardId } : {}) });
  navigateTo(workspaceUrl(id, boardId));
}

/** Downloads text as a file; the browser's download UI is the confirmation. */
export function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function fileStem(title: string): string {
  const stem = title
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : "workspace";
}

/** A readable JSON projection, for tools. Export-only. */
export function downloadWorkspaceJson(workspace: WorkspaceDocument, title = "workspace"): void {
  const portable = exportPortable(workspace);
  downloadText(`${fileStem(title)}.json`, JSON.stringify(portable, null, 2));
}

/** A readable Markdown projection, for people. Export-only. */
export function downloadWorkspaceMarkdown(workspace: WorkspaceDocument, title = "workspace"): void {
  const portable = exportPortable(workspace);
  downloadText(`${fileStem(title)}.md`, portable.markdown, "text/markdown");
}

/** Above this the export still proceeds, but the user is told the real size. */
export const BACKUP_SIZE_WARNING_BYTES = 25 * 1024 * 1024;

/** An image whose bytes no source could produce. */
export interface MissingAttachment {
  id: string;
  name: string | null;
  cards: Array<{ id: string; title: string }>;
}

/** One attachment's bytes, ready for the envelope. */
interface EmbeddedAttachment {
  mime: string;
  name: string;
  width: number | null;
  height: number | null;
  bytes: Uint8Array;
}

export interface AttachmentGathering {
  attachments: Record<string, EmbeddedAttachment>;
  missing: MissingAttachment[];
}

/**
 * Collects the bytes for every image the document references. Local first, then
 * relay. An image found nowhere lands in `missing` with its cards — never
 * silently dropped, because the export is the user's only backup.
 */
export async function gatherAttachments(
  workspace: WorkspaceDocument,
  sources: readonly AttachmentSource[],
): Promise<AttachmentGathering> {
  const attachments: Record<string, EmbeddedAttachment> = {};
  const missing: MissingAttachment[] = [];
  for (const node of documentAttachments(workspace)) {
    const found = await resolveAttachmentBytes(node.id, sources);
    if (found === null) {
      missing.push({ id: node.id, name: node.name, cards: node.cards });
      continue;
    }
    attachments[node.id] = {
      // The node's own type is what the editor drew; a source's type is the
      // fallback for a node written before that attribute existed.
      mime: node.mime ?? (found.mime || "application/octet-stream"),
      name: node.name ?? "",
      width: node.width,
      height: node.height,
      bytes: found.bytes,
    };
  }
  return { attachments, missing };
}

function megabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} MB`;
}

/** UTF-8 size of the exact JSON the download would write. */
export function backupSizeBytes(json: string): number {
  return new TextEncoder().encode(json).byteLength;
}

/**
 * The size warning, or null under the threshold. The real number is in the
 * copy: "large" without a figure tells nobody anything.
 */
export function backupSizeWarning(
  bytes: number,
  threshold = BACKUP_SIZE_WARNING_BYTES,
): string | null {
  if (bytes < threshold) return null;
  return `This backup is ${megabytes(bytes)} with its images. Large files can be slow to save and open, but every image is included.`;
}

function quote(title: string): string {
  return `“${title}”`;
}

/**
 * One readable line naming the affected cards, not their ids. An export that
 * quietly leaves images behind is the data loss this format exists to stop, so
 * this is reported to the user, while the export itself still completes.
 */
export function missingAttachmentWarning(missing: readonly MissingAttachment[]): string | null {
  if (missing.length === 0) return null;
  const titles = [...new Set(missing.flatMap((entry) => entry.cards.map((card) => card.title)))];
  const images = missing.length === 1 ? "1 image is" : `${missing.length} images are`;
  const noun = titles.length === 1 ? "card" : "cards";
  return `${images} missing from this backup (${noun} ${titles.map(quote).join(", ")}). Everything else exported; ${missing.length === 1 ? "that image" : "those images"} will show a placeholder.`;
}

export interface PreparedWorkspaceBackup {
  /** The exact JSON to write to the file. */
  json: string;
  /** UTF-8 byte length of `json`, measured before anything is written. */
  bytes: number;
  missing: MissingAttachment[];
  /** Human-readable warnings, in the order they should be shown. */
  warnings: string[];
}

/** Gathers attachment bytes and builds the envelope, without writing a file. */
export async function prepareWorkspaceBackup(
  workspaceId: string,
  workspace: WorkspaceDocument,
  options: {
    sources?: readonly AttachmentSource[];
    exportedAt?: string;
    /** Overrides `BACKUP_SIZE_WARNING_BYTES`; the warning never blocks. */
    sizeWarningBytes?: number;
    compact?: boolean;
  } = {},
): Promise<PreparedWorkspaceBackup> {
  const sources = options.sources ?? defaultAttachmentSources();
  const { attachments, missing } = await gatherAttachments(workspace, sources);
  const { json } = createWorkspaceFile(
    workspaceId,
    workspace,
    options.exportedAt,
    attachments,
    options.compact ? { compact: true } : undefined,
  );
  const bytes = backupSizeBytes(json);
  const warnings = [
    backupSizeWarning(bytes, options.sizeWarningBytes),
    missingAttachmentWarning(missing),
  ].filter((warning): warning is string => warning !== null);
  return { json, bytes, missing, warnings };
}

/**
 * Exact backup from an already-open workspace, images included.
 *
 * `onWarning` runs before the file is written, so the app can show the real
 * size or the missing-image line first. Neither warning can cancel the export:
 * refusing to back up is worse than a large or incomplete one.
 */
export async function downloadWorkspaceBackup(
  workspaceId: string,
  workspace: WorkspaceDocument,
  title = "workspace",
  options: {
    sources?: readonly AttachmentSource[];
    compact?: boolean;
    onWarning?: (message: string) => void;
  } = {},
): Promise<PreparedWorkspaceBackup> {
  const prepared = await prepareWorkspaceBackup(workspaceId, workspace, {
    ...(options.sources ? { sources: options.sources } : {}),
    ...(options.compact ? { compact: true } : {}),
  });
  if (prepared.warnings.length > 0) options.onWarning?.(prepared.warnings.join(" "));
  downloadText(`${fileStem(title)}.suite`, prepared.json);
  return prepared;
}

/**
 * Export a recent workspace without opening it. The launcher can only export
 * what this browser has cached; a workspace that lives only on the relay must
 * be opened once first. Attachment bytes are gathered exactly as the editor
 * gathers them, so a cached workspace exports complete.
 */
export async function downloadWorkspaceById(
  id: string,
  title = "workspace",
  onWarning?: (message: string) => void,
): Promise<void> {
  const doc = new LoroDoc();
  const persistence = new LoroIndexeddbPersistence(id, doc);
  try {
    await persistence.load();
    const workspace = new WorkspaceDocument(doc);
    if (workspace.listBoards().length === 0 && workspace.listCards().length === 0) {
      throw new Error(
        "This workspace is not stored on this device yet. Open it once, then export.",
      );
    }
    // The launcher shows the same size/missing-image lines the editor shows;
    // an export nobody is told about is how a partial backup goes unnoticed.
    await downloadWorkspaceBackup(id, workspace, title, onWarning ? { onWarning } : {});
  } finally {
    persistence.destroy();
  }
}

export interface ImportedWorkspace {
  id: string;
  boardId?: string;
  title: string;
  /**
   * What the file could not carry — currently the damaged-image sentence, which
   * names the cards rather than dropping the news. The import still succeeded;
   * these are lines the caller must show.
   */
  warnings: string[];
}

/** Writes one image into this browser's store, under the node's own id. */
export type LocalAttachmentWriter = (id: string, bytes: Uint8Array, mime: string) => Promise<void>;

export interface ImportWorkspaceOptions {
  /** Local byte store; IndexedDB unless a test supplies its own. */
  storeAttachment?: LocalAttachmentWriter;
  /** Persists the imported document; IndexedDB unless a test supplies its own. */
  persist?: (workspaceId: string, doc: LoroDoc) => Promise<void>;
}

async function persistWithIndexedDb(workspaceId: string, doc: LoroDoc): Promise<void> {
  const persistence = new LoroIndexeddbPersistence(workspaceId, doc);
  try {
    await persistence.open();
    await persistence.compact();
  } finally {
    persistence.destroy();
  }
}

/**
 * Import a `.suite` backup into a brand-new workspace id. The current document
 * is never touched, so import can never merge two histories.
 */
export async function importWorkspaceFile(
  file: File,
  options: ImportWorkspaceOptions = {},
): Promise<ImportedWorkspace> {
  const text = await file.text();
  const { workspace, attachments, damaged } = readWorkspaceFile(text);
  const id = newWorkspaceId();

  // Restore every embedded image under the id its node already carries, so the
  // card renders the moment it opens. These copies are LOCAL-ONLY — the same
  // state a paste reaches with no relay — i.e. not yet uploaded: a share viewer
  // resolves the node only once the owning relay holds the bytes under this id.
  const storeAttachment = options.storeAttachment ?? storeLocalAttachment;
  for (const attachment of attachments) {
    try {
      await storeAttachment(attachment.id, attachment.bytes, attachment.mime);
    } catch (error) {
      // One image that cannot be cached must not cost the user the document.
      console.warn(`[attachments] could not restore ${attachment.id} from the backup`, error);
    }
  }

  const doc = workspace.doc;
  await (options.persist ?? persistWithIndexedDb)(id, doc);
  const restored = new WorkspaceDocument(doc);
  const board = restored.listBoards().sort((left, right) => left.createdAt - right.createdAt)[0];
  const title = board?.name?.trim() || "Imported workspace";
  rememberWorkspace({ id, title, boardId: board?.id ?? null });
  // An image the file cannot supply is named by the cards that show it, because
  // a backup that quietly imports a hole is the loss the format exists to stop.
  const warnings = [damagedAttachmentWarning(damaged)].filter(
    (warning): warning is string => warning !== null,
  );
  return { id, title, warnings, ...(board ? { boardId: board.id } : {}) };
}
