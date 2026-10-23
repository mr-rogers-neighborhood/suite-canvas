/**
 * Share capabilities for the ICE surface.
 *
 * A share session is a capability link, not a workspace login: the same canvas
 * code serves an owner, a board editor, a card editor and every reader, and the
 * only thing that differs is which writes are reachable. `session.ts` derives
 * the shell's matrix (`SessionCapabilities`) once at boot; this module narrows
 * that matrix to what the ICE surface can actually express — the editing
 * controller's capability object, pin drop and management, card creation, the
 * inspector, pointer-drag presence — and adds the scope filters the surface
 * needs to refuse a target that lies outside the projection.
 *
 * ## Rule table
 *
 * `ui.x` below means `!ui.readOnly && ui.x`. A viewer row never consults the UI
 * matrix, because a viewer writes nothing at all.
 *
 * | session                   | role   | bridge.write | canWriteLayout | canDropPin     | canManagePins                | canCreateCards          | canEditContent | canPublishDrag | pinsBoardScope |
 * | ------------------------- | ------ | ------------ | -------------- | -------------- | ---------------------------- | ----------------------- | -------------- | -------------- | -------------- |
 * | no share (owner)          | owner  | canWriteLayout | ui.layout      | canWriteLayout | canWriteLayout && ui.schema  | ui.layout && ui.content | ui.content     | canWriteLayout | all            |
 * | workspace editor          | editor | canWriteLayout | ui.layout      | canWriteLayout | canWriteLayout && ui.schema  | ui.layout && ui.content | ui.content     | canWriteLayout | all            |
 * | board editor              | editor | canWriteLayout | ui.layout      | canWriteLayout | canWriteLayout               | ui.layout && ui.content | ui.content     | canWriteLayout | scoped         |
 * | card editor               | editor | no           | no             | no             | no                           | no                      | ui.content     | no             | scoped         |
 * | any viewer                | viewer | no           | no             | no             | no                           | no                      | no             | no             | scope's own    |
 * | selection (always viewer) | viewer | no           | no             | no             | no                           | no                      | no             | no             | scoped         |
 *
 * `bridge.write` is the controller gate: the controller derives its
 * capabilities from `controllerRole`, so a card editor keeps the `editor`
 * identity (and `canEditContent`) while the canvas around it is read-only.
 *
 * A board editor manages the pins of its own board (the surface lists only
 * those); a workspace editor manages every pin, which is workspace
 * configuration and follows `canManageSchema`, matching `PinsPanel`'s default
 * gate. A card share owns no board, so it owns no pin, no placement and no
 * creation — its editor writes card content only.
 *
 * Two degradations are deliberate: a share whose scope cannot name its target
 * (a board share without a board id, a card share without a card id) is a
 * viewer, and a selection share is a viewer whatever its role field says — the
 * server only issues viewer selection links, and `sessionCapabilities` refuses
 * the same way.
 *
 * ## What this module does not do
 *
 * No React, DOM or ICE import: the inputs are structural, so the shell can pass
 * `session.share` and its own store fields without this module knowing either.
 * Nothing here reads or writes the document; the surface asks, then acts.
 */

import type { ShareRole, ShareScope } from "../session/shares";
import { capabilitiesForRole, type IceCapabilities, type IceSessionRole } from "./iceBridge";

/* ------------------------------------------------------------------ inputs */

/**
 * The resolved share, structurally: `ShareSession` and `Share` both satisfy it.
 * Ids are read per scope, so a value the scope does not use is ignored.
 */
export interface IceShareScopeInput {
  readonly scope: ShareScope;
  readonly role: ShareRole;
  readonly boardId?: string | null | undefined;
  readonly cardId?: string | null | undefined;
  /** Cards of a selection share; absent on a `ShareSession`. */
  readonly cardIds?: readonly string[] | null | undefined;
}

/** The UI matrix rows this module reads; mirrors `SessionCapabilities`. */
export interface IceShareUiCapabilities {
  readonly readOnly: boolean;
  readonly canEditLayout: boolean;
  readonly canEditContent: boolean;
  readonly canManageSchema: boolean;
  /** Accepted for symmetry with the session matrix; ICE has no trash surface. */
  readonly canManageTrash: boolean;
}

export interface IceShareCapsInput {
  /** `session.share`; `null` for a normal (owner) session. */
  readonly share: IceShareScopeInput | null;
  readonly ui: IceShareUiCapabilities;
}

/** A document target an action would touch. A missing id is unknown, not a wildcard. */
export interface IceShareTarget {
  readonly boardId?: string | null | undefined;
  readonly cardId?: string | null | undefined;
}

/* ----------------------------------------------------------------- outputs */

/** Which boards' pins a surface lists. */
export type IcePinsBoardScope = "all" | "scoped";

export interface IceShareCaps {
  /** The document identity: an owner, an editor, or a reader. */
  readonly role: IceSessionRole;
  /**
   * Exactly what `createIceEditingController` receives as `role`. The controller
   * derives its capabilities from this, so it follows layout authority: a card
   * share (which owns content, not placement) and any read-only UI gate to
   * `viewer` even when `role` is `editor`.
   */
  readonly controllerRole: IceSessionRole;
  /** `capabilitiesForRole(controllerRole)`; the same gate as an object. */
  readonly bridge: IceCapabilities;
  readonly canWriteLayout: boolean;
  readonly canDropPin: boolean;
  readonly canManagePins: boolean;
  readonly canCreateCards: boolean;
  /** Card body, title, properties and tags. A reader gets a static card face. */
  readonly canEditContent: boolean;
  /** Reading is not a capability: the inspector opens read-only for a viewer. */
  readonly canOpenInspector: boolean;
  /** Pointer drag presence. A viewer, or a card share, publishes no drag. */
  readonly canPublishDrag: boolean;
  readonly pinsBoardScope: IcePinsBoardScope;
  /** The one board a board or selection share may touch, else `null`. */
  readonly boardIdFilter: string | null;
  /** The one card a card share may touch, else `null`. */
  readonly cardIdFilter: string | null;
}

/* ---------------------------------------------------------------- internals */

function cleanId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

interface ShareAuthority {
  readonly role: IceSessionRole;
  /** Board the share names, whoever may write. */
  readonly boardId: string | null;
  readonly cardId: string | null;
}

/**
 * Resolves a share's writable authority. Anything that cannot name the target
 * it claims — or that the server never grants write access to — reads as a
 * viewer, so a malformed link can only ever read.
 */
function shareAuthority(share: IceShareScopeInput | null): ShareAuthority {
  if (share === null) return { role: "owner", boardId: null, cardId: null };
  const boardId = cleanId(share.boardId);
  const cardId = cleanId(share.cardId);
  if (share.role !== "editor") return { role: "viewer", boardId, cardId };
  switch (share.scope) {
    case "workspace":
      return { role: "editor", boardId, cardId };
    case "board":
      return { role: boardId === null ? "viewer" : "editor", boardId, cardId };
    case "card":
      return { role: cardId === null ? "viewer" : "editor", boardId, cardId };
    case "selection":
      // A selection link is viewer-only server-side: never grant write access.
      return { role: "viewer", boardId, cardId };
    default:
      return { role: "viewer", boardId, cardId };
  }
}

/** Only a board-scoped projection narrows the pin list to one board. */
function scopeBoardId(share: IceShareScopeInput | null): string | null {
  if (share === null || share.scope === "workspace") return null;
  return cleanId(share.boardId);
}

/* --------------------------------------------------------------------- API */

/** The ICE capability row for one session. Pure: same input, same output. */
export function iceShareCaps(input: IceShareCapsInput): IceShareCaps {
  const { share, ui } = input;
  const authority = shareAuthority(share);
  const editor = authority.role !== "viewer";
  const writable = !ui.readOnly;
  const scope: ShareScope = share?.scope ?? "workspace";
  const boardIdFilter = scopeBoardId(share);
  const cardIdFilter = scope === "card" ? cleanId(share?.cardId) : null;

  const content = editor && writable && ui.canEditContent;
  // A card share owns content only: its board, placements and pin set belong to
  // the projection the owner published, never to the sharer.
  const layout = editor && writable && ui.canEditLayout && scope !== "card";
  const canDropPin = layout;
  // A board editor manages the pins of its own board; a workspace editor
  // reaches every pin, which is workspace configuration.
  const canManagePins = layout && (scope === "workspace" ? ui.canManageSchema : true);

  // The inspector only needs a target it can resolve: a malformed board or card
  // share has nothing to inspect, and neither does a selection with no board.
  const canOpenInspector =
    share === null ||
    scope === "workspace" ||
    (scope === "card" ? cardIdFilter !== null : boardIdFilter !== null);

  const controllerRole: IceSessionRole = layout ? authority.role : "viewer";

  return {
    role: authority.role,
    controllerRole,
    bridge: capabilitiesForRole(controllerRole),
    canWriteLayout: layout,
    canDropPin,
    canManagePins,
    canCreateCards: layout && content,
    canEditContent: content,
    canOpenInspector,
    canPublishDrag: layout,
    pinsBoardScope: scope === "workspace" ? "all" : "scoped",
    boardIdFilter,
    cardIdFilter,
  };
}

/**
 * True when `target` lies inside the projection this session writes. A target
 * that names nothing is unknown and therefore false; a viewer share is outside
 * every writable scope, so the surface refuses the action.
 */
export function withinShareScope(
  target: IceShareTarget,
  session: IceShareScopeInput | null,
): boolean {
  const boardId = cleanId(target.boardId);
  const cardId = cleanId(target.cardId);
  if (boardId === null && cardId === null) return false;
  if (session === null) return true;
  const authority = shareAuthority(session);
  if (authority.role === "viewer") return false;
  switch (session.scope) {
    case "workspace":
      return true;
    case "board": {
      if (authority.boardId === null) return false;
      // A card-only target comes from the projection itself, so the board is
      // the only dimension that can put it out of scope.
      return boardId === null || boardId === authority.boardId;
    }
    case "card": {
      // A board target is outside a card share: it owns no placement.
      if (cardId === null || authority.cardId === null) return false;
      if (cardId !== authority.cardId) return false;
      return boardId === null || authority.boardId === null || boardId === authority.boardId;
    }
    default:
      // A selection is viewer-only, so it never reaches a writable scope.
      return false;
  }
}

/**
 * The pins a surface may show, in the order they arrived. A card share carries
 * no board authority and lists none; a board or selection share keeps exactly
 * its board's markers; an owner or workspace share keeps them all.
 */
export function visiblePinFilter<T extends { readonly boardId: string }>(
  pins: readonly T[],
  session: IceShareScopeInput | null,
): T[] {
  if (session === null || session.scope === "workspace") return [...pins];
  if (session.scope === "card") return [];
  const boardId = scopeBoardId(session);
  if (boardId === null) return [];
  return pins.filter((pin) => pin.boardId === boardId);
}
