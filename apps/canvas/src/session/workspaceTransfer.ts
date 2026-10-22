import { createWorkspaceFile, exportPortable, WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { LoroIndexeddbPersistence } from "../collab/loroPersistence";

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

export function workspaceUrl(workspaceId: string, boardId?: string | null): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("workspace", workspaceId);
  if (boardId) url.searchParams.set("board", boardId);
  return url.toString();
}

export function newWorkspaceId(): string {
  return crypto.randomUUID();
}

/** A new workspace starts empty; the flag keeps the starter demo cards out. */
export function openNewWorkspace(): void {
  const id = newWorkspaceId();
  rememberWorkspace({ id, title: "Untitled workspace" });
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("workspace", id);
  url.searchParams.set("fresh", "1");
  window.location.assign(url.toString());
}

export function openWorkspace(id: string, boardId?: string | null): void {
  rememberWorkspace({ id, ...(boardId ? { boardId } : {}) });
  window.location.assign(workspaceUrl(id, boardId));
}

function downloadText(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function fileStem(title: string): string {
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

/** Exact backup from an already-open workspace. */
export function downloadWorkspaceBackup(
  workspaceId: string,
  workspace: WorkspaceDocument,
  title = "workspace",
): void {
  const { json } = createWorkspaceFile(workspaceId, workspace);
  downloadText(`${fileStem(title)}.suite`, json);
}

/**
 * Export a recent workspace without opening it. The launcher can only export
 * what this browser has cached; a workspace that lives only on the relay must
 * be opened once first.
 */
export async function downloadWorkspaceById(id: string, title = "workspace"): Promise<void> {
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
    downloadWorkspaceBackup(id, workspace, title);
  } finally {
    persistence.destroy();
  }
}

export interface ImportedWorkspace {
  id: string;
  boardId?: string;
  title: string;
}

/**
 * Import a `.suite` backup into a brand-new workspace id. The current document
 * is never touched, so import can never merge two histories.
 */
export async function importWorkspaceFile(file: File): Promise<ImportedWorkspace> {
  const text = await file.text();
  const { readWorkspaceFile } = await import("@suite/graph");
  const { workspace } = readWorkspaceFile(text);
  const id = newWorkspaceId();
  const doc = workspace.doc;
  const persistence = new LoroIndexeddbPersistence(id, doc);
  try {
    await persistence.open();
    await persistence.compact();
  } finally {
    persistence.destroy();
  }
  const restored = new WorkspaceDocument(doc);
  const board = restored.listBoards().sort((left, right) => left.createdAt - right.createdAt)[0];
  const title = board?.name?.trim() || "Imported workspace";
  rememberWorkspace({ id, title, boardId: board?.id ?? null });
  return { id, title, ...(board ? { boardId: board.id } : {}) };
}
