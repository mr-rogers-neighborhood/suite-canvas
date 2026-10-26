/**
 * Owns the document's fixed names: the default ids, the schema version, the origin strings
 * a commit carries, and the workspace-name rules.
 */
/** Deterministic id so every client seeds the same default board. */
export const DEFAULT_BOARD_ID = "board-1";

/** The built-in type of a card that stands for another board. */
export const PORTAL_TYPE_ID = "portal";

/** Stable field id for the portal's board value; the UI and seeds rely on it. */
export const PORTAL_BOARD_FIELD_ID = "portal-board";

/** Spatial sections start at version 4. */
export const SCHEMA_VERSION = 4;

/** Shown for a workspace that has never been named and has no board to borrow from. */
export const DEFAULT_WORKSPACE_NAME = "Untitled workspace";

export const WORKSPACE_NAME_MAX_LENGTH = 80;

/**
 * A readable reason the name cannot be used, or `null` when it can. Control
 * characters are refused because the name is a one-line label everywhere it
 * appears (launcher, recovery file names).
 */
export function workspaceNameProblem(name: string): string | null {
  if (/\p{Cc}/u.test(name)) return "A workspace name cannot contain control characters.";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "A workspace name cannot be empty.";
  if (trimmed.length > WORKSPACE_NAME_MAX_LENGTH) {
    return `A workspace name can be at most ${WORKSPACE_NAME_MAX_LENGTH} characters.`;
  }
  return null;
}

/** The trimmed name, or a thrown reason when it is not usable. */
export function cleanWorkspaceName(name: string): string {
  const problem = workspaceNameProblem(name);
  if (problem) throw new Error(problem);
  return name.trim();
}

/** Below this gap two ranks are one float step apart; the board renumbers. */
export const MIN_RANK_GAP = 1e-7;

export const CONNECTORS_FIELD = "connectors";

/** The ProseMirror node name of an inline property block. */
export const PROPERTY_BLOCK_NODE_NAME = "propertyBlock";

/**
 * Origin of body property-block writes. `text:body` keeps the insertion in the
 * same Loro history as the body editor's own edits, so a mounted editor can
 * undo "Show in body" with Cmd-Z; a `struct:` origin is excluded from the
 * editor's undo stack and would leave an edit that cannot be reverted there.
 */
export const BODY_BLOCK_ORIGIN = "text:body";

/** Origin prefixes that keep text/editor history out of the structural undo stack. */
export const TEXT_ORIGIN_PREFIX = "loroSyncPlugin";

export const INIT_ORIGIN = "sys:init";

/**
 * Origin of derived reference-index writes. Excluded from both undo stacks: the
 * index is rebuilt from content, so reverting it would make it lie.
 */
export const INDEX_ORIGIN = "struct:index-refs";

export const STRUCT_ORIGIN = "struct:";

export function placementKey(boardId: string, cardId: string): string {
  return `${boardId}/${cardId}`;
}
