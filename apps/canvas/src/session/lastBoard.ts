/**
 * The board a workspace was last on, per browser.
 *
 * This replaced two settings ("home board", "new-tab board") that asked the
 * reader to answer, once and for all, a question they answer just by working:
 * which board should open. Remembering the last one is right whenever the answer
 * is "wherever I was", and the address bar still wins when a link names a board.
 */
const KEY = "suite.lastBoard.v1";

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readAll(): Record<string, string> {
  if (!hasStorage()) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: Record<string, string> = {};
    for (const [workspaceId, boardId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof boardId === "string") map[workspaceId] = boardId;
    }
    return map;
  } catch {
    return {};
  }
}

export function readLastBoard(workspaceId: string): string | null {
  return readAll()[workspaceId] ?? null;
}

export function rememberLastBoard(workspaceId: string, boardId: string): void {
  if (!hasStorage()) return;
  const all = readAll();
  if (all[workspaceId] === boardId) return;
  all[workspaceId] = boardId;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // The address bar is the real record; this is only a convenience.
  }
}

export function forgetLastBoard(workspaceId: string): void {
  const all = readAll();
  if (!(workspaceId in all)) return;
  delete all[workspaceId];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Nothing to recover: a stale id fails the "does this board exist" check.
  }
}
