/**
 * The session: which document is open, and what the window may do with it.
 *
 * There used to be three sources of authority — an anonymous visitor, an account,
 * and a share link — and every capability question was answered against whichever
 * one was present. The relay that minted all three is gone, so there is one
 * answer: the app edits its own file, and everything a file's owner could do is
 * what a person can do.
 *
 * The names below survive because surfaces ask for them by name. `share` is
 * always null, `isShareSession` never fires, and `ShareSession` keeps a shape so a
 * component that types a prop or branches on a field still compiles. A surface
 * that checks for a share is checking a case this build cannot produce.
 */

/**
 * What a session may do, derived once at boot. Each row is its own flag rather
 * than one read-only switch, because a surface should ask the question it
 * actually has.
 */
export interface SessionCapabilities {
  /** Title, body, properties, existing tags and new tags on a card. */
  canEditContent: boolean;
  /** Placement, sections, edges and card geometry on the board. */
  canEditLayout: boolean;
  /** Write a draft back to an owner's workspace; a local file has no draft. */
  canPublish: boolean;
  /** New cards, sections, edges and connectors. */
  canCreateContent: boolean;
  /** Add a board. */
  canCreateBoards: boolean;
  /** Rename or delete a board. */
  canManageBoards: boolean;
  /** Types, fields, tags and card type reassignment. */
  canManageSchema: boolean;
  /** Trash, restore, purge and empty the trash. */
  canManageTrash: boolean;
  /** Share links and workspace deletion. Both needed a service; neither exists. */
  canManageLinks: boolean;
}

/** The person with the file: everything but the two service-backed rows. */
export const LOCAL_CAPABILITIES: SessionCapabilities = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: false,
  canCreateContent: true,
  canCreateBoards: true,
  canManageBoards: true,
  canManageSchema: true,
  canManageTrash: true,
  canManageLinks: false,
};

/** A share link is a capability the retired relay minted; no value of this type can be made. */
export type ShareSession = {
  readonly scope: "workspace" | "board" | "card" | "selection";
  readonly role: "editor" | "viewer";
  readonly token: string;
  readonly cardId: string | null;
  readonly startBoardId: string | null;
};

/** How the page proved who it is. There is nothing to prove now. */
export type SessionCredential = "none";

export type SessionRole = "editor";

export interface SessionConfig {
  readonly workspaceId: string | null;
  readonly roomId: string | null;
  readonly share: ShareSession | null;
  readonly role: SessionRole;
  readonly readOnly: boolean;
  readonly credential: SessionCredential;
}

/** A page URL's query parameter, or null when it is absent or empty. */
function searchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(key);
  return value !== null && value.length > 0 ? value : null;
}

/** Workspace named by `?workspace=` (or the legacy `?doc=`), if any. */
function workspaceFromUrl(): string | null {
  return searchParam("workspace") ?? searchParam("doc");
}

/** The session a page starts with: the document named in its URL, editable. */
function defaultSession(): SessionConfig {
  const workspaceId = workspaceFromUrl();
  return {
    workspaceId,
    roomId: workspaceId,
    share: null,
    role: "editor",
    readOnly: false,
    credential: "none",
  };
}

let current: SessionConfig = defaultSession();
const listeners = new Set<(session: SessionConfig) => void>();

/** The session every surface reads. */
export function getSession(): SessionConfig {
  return current;
}

/** Replace the session, when the shell opens a document. */
export function configureSession(session: SessionConfig): void {
  current = session;
  for (const listener of listeners) listener(session);
}

/** Watch the session, for a surface that renders differently per document. */
export function onSessionChange(listener: (session: SessionConfig) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The session for a document the shell opened, or a stripped copy of one. */
export function standaloneSession(
  options: { workspaceId?: string | null; roomId?: string | null } = {},
): SessionConfig {
  const workspaceId = options.workspaceId ?? null;
  return {
    workspaceId,
    roomId: options.roomId ?? workspaceId,
    share: null,
    role: "editor",
    readOnly: false,
    credential: "none",
  };
}

/**
 * Never true. A share is a capability a link holder presented to the relay, and
 * the relay is gone; the name survives because surfaces still branch on it.
 */
export function isShareSession(_session: SessionConfig = current): boolean {
  return false;
}

/** What this session may do. One row for every document. */
export function sessionCapabilities(_session: SessionConfig = current): SessionCapabilities {
  return LOCAL_CAPABILITIES;
}
