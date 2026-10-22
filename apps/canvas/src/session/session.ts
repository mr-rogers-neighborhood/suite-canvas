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
