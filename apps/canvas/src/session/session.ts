import type { Share, ShareRole, ShareScope } from "./shares";

/**
 * One capability link, resolved before the app boots. Board and card shares are
 * projections that live in their own room, so `workspaceId` is the room the
 * session reads — never the owner's workspace id, which the server redacts for
 * those scopes.
 */
export interface ShareSession {
  token: string;
  scope: ShareScope;
  role: ShareRole;
  /** Document the shell shows and persists under; the projection room for board/card. */
  workspaceId: string;
  boardId: string | null;
  cardId: string | null;
  /** Sync room the provider joins. */
  roomId: string;
}

export interface SessionConfig {
  workspaceId: string | null;
  roomId: string | null;
  share: ShareSession | null;
  role: ShareRole;
  readOnly: boolean;
  /**
   * Owner credential of a normal editor session. Share sessions never carry it;
   * they authenticate with their token instead.
   */
  ownerKey: string | null;
}

/**
 * What a session may do, derived once at boot. The UI hides what a session
 * cannot do rather than disabling it, so these flags — not `readOnly` — are the
 * primary gate for content, layout, publishing, creation and management.
 */
export interface SessionCapabilities {
  /** Title, body, properties and existing tags. */
  canEditContent: boolean;
  /** Placement, sections and edges on the shared board. */
  canEditLayout: boolean;
  /** Write the draft back to the owner's workspace. */
  canPublish: boolean;
  /** New cards, sections, edges, connectors and boards. */
  canCreate: boolean;
  /** Trash, type/tag schema, share management — owner-only. */
  canManage: boolean;
}

const OWNER_CAPABILITIES: SessionCapabilities = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: true,
  canCreate: true,
  canManage: true,
};

const VIEWER_CAPABILITIES: SessionCapabilities = {
  canEditContent: false,
  canEditLayout: false,
  canPublish: false,
  canCreate: false,
  canManage: false,
};

/** A board editor may change what the board already contains, never grow it. */
const BOARD_EDITOR_CAPABILITIES: SessionCapabilities = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: true,
  canCreate: false,
  canManage: false,
};

/** A card editor only touches one card's content. */
const CARD_EDITOR_CAPABILITIES: SessionCapabilities = {
  canEditContent: true,
  canEditLayout: false,
  canPublish: true,
  canCreate: false,
  canManage: false,
};

/**
 * Capability matrix:
 * - no share (owner) or a workspace editor link: everything;
 * - any viewer: nothing;
 * - board editor: content + layout + publish;
 * - card editor: content + publish.
 */
export function sessionCapabilities(session: SessionConfig): SessionCapabilities {
  const { share } = session;
  if (!share) return OWNER_CAPABILITIES;
  if (share.role === "viewer") return VIEWER_CAPABILITIES;
  if (share.scope === "workspace") return OWNER_CAPABILITIES;
  return share.scope === "board" ? BOARD_EDITOR_CAPABILITIES : CARD_EDITOR_CAPABILITIES;
}

function searchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/** Share token the page was opened with, if any. */
export function resolveShareToken(): string | null {
  const token = searchParam("share");
  return token && token.length > 0 ? token : null;
}

/** A normal editor session from `?workspace=` (or the legacy `?doc=`). */
function defaultSession(): SessionConfig {
  const workspaceId = searchParam("workspace") ?? searchParam("doc");
  return {
    workspaceId,
    roomId: workspaceId,
    share: null,
    role: "editor",
    readOnly: false,
    ownerKey: null,
  };
}

/**
 * The projection room for a board or card share. The API returns it, but a
 * resolver that only knows the token still lands on the same room.
 */
export function projectionRoomId(token: string, share: Share): string {
  if (share.scope === "workspace") return share.roomId ?? share.workspaceId;
  return share.roomId ?? `share-${token}`;
}

/** Session for a resolved share. Synchronous and safe to run before `App` loads. */
export function sessionForShare(token: string, share: Share): SessionConfig {
  const roomId = projectionRoomId(token, share);
  const projected = share.scope === "board" || share.scope === "card";
  // A projected share must not carry the owner's id anywhere: the room is the
  // only document this viewer may read.
  const workspaceId = projected ? roomId : share.workspaceId || roomId;
  return {
    workspaceId,
    roomId,
    share: {
      token,
      scope: share.scope,
      role: share.role,
      workspaceId,
      boardId: share.boardId,
      cardId: share.cardId,
      roomId,
    },
    role: share.role,
    readOnly: share.role === "viewer",
    ownerKey: null,
  };
}

let current: SessionConfig = defaultSession();

/** Replaces the session. `main.tsx` calls this before importing the app. */
export function configureSession(config: SessionConfig): void {
  current = config;
}

export function getSession(): SessionConfig {
  return current;
}

/** True for any `?share=` session, viewer or (workspace-only) editor. */
export function isShareSession(): boolean {
  return current.share !== null;
}
