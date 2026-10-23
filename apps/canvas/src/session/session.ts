import { isStandalone } from "./mode";
import type { Share, ShareRole, ShareScope } from "./shares";
import {
  activeShareCredential,
  isShareSessionResume,
  SHARE_SESSION_FRAGMENT,
  SHARE_SESSION_RESUME,
} from "./shares";

/**
 * One capability link, resolved before the app boots. Board, card and selection
 * shares are projections that live in their own room, so `workspaceId` is the
 * room the session reads — never the owner's workspace id, which the server
 * redacts for those scopes.
 */
export interface ShareSession {
  /**
   * Capability this page presents: the exchanged session while the exchange is
   * live, otherwise the raw link token (an older server, or a rejected
   * exchange). The server accepts either for the room join.
   */
  token: string;
  scope: ShareScope;
  role: ShareRole;
  /** Document the shell shows and persists under; the projection room for board/card/selection. */
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
 * What a session may do, derived once at boot. Each row of the capability
 * matrix is its own flag: the UI hides what a session cannot do rather than
 * disabling it, so these flags — not a single read-only or owner switch — are
 * the primary gate for every surface.
 */
export interface SessionCapabilities {
  /** Title, body, properties, existing tags and new tags on a card. */
  canEditContent: boolean;
  /** Placement, sections, edges and card geometry on the shared board. */
  canEditLayout: boolean;
  /** Write a share draft back to the owner's workspace; an owner edits live. */
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
  /** Share links, owner-key rotation and workspace deletion — owner only. */
  canManageLinks: boolean;
}

/** The owner edits the live workspace: there is no draft, so publishing does not apply. */
const OWNER_CAPABILITIES: SessionCapabilities = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: false,
  canCreateContent: true,
  canCreateBoards: true,
  canManageBoards: true,
  canManageSchema: true,
  canManageTrash: true,
  canManageLinks: true,
};

const VIEWER_CAPABILITIES: SessionCapabilities = {
  canEditContent: false,
  canEditLayout: false,
  canPublish: false,
  canCreateContent: false,
  canCreateBoards: false,
  canManageBoards: false,
  canManageSchema: false,
  canManageTrash: false,
  canManageLinks: false,
};

/** A workspace editor token edits the whole live workspace but cannot manage links or ownership. */
const WORKSPACE_EDITOR_CAPABILITIES: SessionCapabilities = {
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

/** A board editor works on the shared board's draft: content, layout, creation and publish. */
const BOARD_EDITOR_CAPABILITIES: SessionCapabilities = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: true,
  canCreateContent: true,
  canCreateBoards: false,
  canManageBoards: false,
  canManageSchema: false,
  canManageTrash: false,
  canManageLinks: false,
};

/**
 * A standalone build edits the one document this browser holds. It is owner of
 * everything local — content, layout, creation, boards, schema and trash — but
 * there is no relay, so nothing to publish and no link to manage. The sharing
 * surfaces read these flags, so `Share`/`Publish` never render rather than
 * rendering disabled.
 */
export const STANDALONE_CAPABILITIES: SessionCapabilities = {
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

/** A card editor only touches one card's content. */
const CARD_EDITOR_CAPABILITIES: SessionCapabilities = {
  canEditContent: true,
  canEditLayout: false,
  canPublish: true,
  canCreateContent: false,
  canCreateBoards: false,
  canManageBoards: false,
  canManageSchema: false,
  canManageTrash: false,
  canManageLinks: false,
};

/**
 * Capability matrix:
 * - standalone: everything local, nothing that needs a relay (no links, no publish);
 * - no share (owner): everything, including links and ownership;
 * - a selection: nothing — the server only ever issues viewer links for it;
 * - any viewer: nothing;
 * - workspace editor token: the live workspace minus links and ownership, and no publish;
 * - board editor: content, layout, creation and publish on one board's draft;
 * - card editor: content and publish for one card.
 */
export function sessionCapabilities(session: SessionConfig): SessionCapabilities {
  // The build profile outranks any URL: a standalone bundle never resolves a
  // share, so it can never hand out a share's narrower capability row either.
  if (isStandalone()) return STANDALONE_CAPABILITIES;
  const { share } = session;
  if (!share) return OWNER_CAPABILITIES;
  // A selection is viewer-only server-side: never grant write access, even if a
  // role field disagrees.
  if (share.scope === "selection") return VIEWER_CAPABILITIES;
  if (share.role === "viewer") return VIEWER_CAPABILITIES;
  if (share.scope === "workspace") return WORKSPACE_EDITOR_CAPABILITIES;
  return share.scope === "board" ? BOARD_EDITOR_CAPABILITIES : CARD_EDITOR_CAPABILITIES;
}

function searchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

/**
 * True when the page was opened with a link but the exchange has already run:
 * the token is gone from the URL and only the session cookie remains, so boot
 * must resume from `GET /api/shares/session` instead of a token.
 */
function hasShareSessionMarker(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hash === SHARE_SESSION_FRAGMENT;
}

/**
 * Share credential the page was opened with, if any. Once the exchange has run
 * this is `SHARE_SESSION_RESUME`, a sentinel rather than a credential: the
 * cookie is the credential.
 */
export function resolveShareToken(): string | null {
  const token = searchParam("share");
  if (token && token.length > 0) return token;
  return hasShareSessionMarker() ? SHARE_SESSION_RESUME : null;
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
 * The projection room for a board, card or selection share. The API returns it,
 * but a resolver that only knows the token still lands on the same room.
 */
export function projectionRoomId(token: string, share: Share): string {
  if (share.scope === "workspace") return share.roomId ?? share.workspaceId;
  return share.roomId ?? `share-${token}`;
}

/** Session for a resolved share. Synchronous and safe to run before `App` loads. */
export function sessionForShare(token: string, share: Share): SessionConfig {
  const roomId = projectionRoomId(token, share);
  const projected =
    share.scope === "board" || share.scope === "card" || share.scope === "selection";
  // A projected share must not carry the owner's id anywhere: the room is the
  // only document this viewer may read.
  const workspaceId = projected ? roomId : share.workspaceId || roomId;
  // A selection link is viewer-only, so its session is read-only whatever the
  // role field says.
  const readOnly = share.role === "viewer" || share.scope === "selection";
  return {
    workspaceId,
    roomId,
    share: {
      // The exchange's session outranks the link token: it is the credential the
      // room join and the draft API present, and it dies with the share. Without
      // an exchange (an older server) the token is still the credential.
      token: activeShareCredential() ?? (isShareSessionResume(token) ? "" : token),
      scope: share.scope,
      role: share.role,
      workspaceId,
      boardId: share.boardId,
      cardId: share.cardId,
      roomId,
    },
    role: share.role,
    readOnly,
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

/**
 * The session a standalone build boots: the local document the URL names, with
 * no relay identity at all — there is no owner key to claim and no share to
 * read, so both stay null whatever the URL says.
 */
export function standaloneSession(base: SessionConfig = current): SessionConfig {
  return { ...base, share: null, ownerKey: null };
}
