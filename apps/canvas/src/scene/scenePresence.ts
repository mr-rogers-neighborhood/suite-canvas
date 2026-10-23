import {
  type Point,
  type PortalInstance,
  type Rect,
  rectContainsPoint,
  type Scene,
  type Transform,
  transformPoint,
  transformRect,
} from "@suite/scene";
import type { PeerPresence } from "../collab/presence";

/**
 * Peers seen on the scene surface. Presence is workspace-wide and every sample
 * is published in the root board's coordinates, which are the scene's page
 * coordinates because the root instance uses the identity transform. Anything
 * derived here is therefore page-space and pans/zooms with the camera for free.
 */

/** One visible instance of a peer's selection. */
export interface PeerSelectionOutline {
  readonly peer: PeerPresence;
  readonly instanceKey: string;
  readonly cardId: string | null;
  readonly sectionId: string | null;
  readonly rect: Rect;
}

/** A peer's in-flight drag or resize, drawn where the instance actually is. */
export interface PeerGhost {
  readonly peer: PeerPresence;
  readonly instanceKey: string;
  readonly kind: "drag" | "resize" | "section-drag" | "section-resize";
  readonly rect: Rect;
  /** Exactly one ghost per gesture carries the name chip. */
  readonly anchor: boolean;
  /** Extra chip context, e.g. how many cards a multi-drag moves. */
  readonly detail?: string | undefined;
}

/** A peer's pointer, clipped to the portal whose content it is over. */
export interface PeerPointerDot {
  readonly peer: PeerPresence;
  /** Page-space sample. */
  readonly point: Point;
  /** Portal frame the dot must be clipped to, or null at the top level. */
  readonly clip: Rect | null;
}

interface InstanceBox {
  readonly key: string;
  readonly boardId: string;
  readonly transform: Transform;
  /** Canonical board-space box. */
  readonly local: Rect;
  /** Canonical page-space box. */
  readonly rect: Rect;
}

type RectLookup = (instanceKey: string, rect: Rect) => Rect;

function cardBoxes(scene: Scene, cardId: string): InstanceBox[] {
  const boxes: InstanceBox[] = [];
  for (const card of scene.cards) {
    // A portal card is drawn as its frame; the box underneath it would be a
    // second outline in the same place.
    if (card.cardId !== cardId || card.portalKey !== null || card.lod === "hidden") continue;
    boxes.push({
      key: card.key,
      boardId: card.boardId,
      transform: card.transform,
      local: card.local,
      rect: card.rect,
    });
  }
  for (const portal of scene.portals) {
    if (portal.cardId !== cardId || portal.lod === "hidden") continue;
    boxes.push({
      key: portal.key,
      boardId: portal.boardId,
      transform: portal.transform,
      local: portal.localFrame,
      rect: portal.frame,
    });
  }
  return boxes;
}

function sectionBoxes(scene: Scene, sectionId: string): InstanceBox[] {
  const boxes: InstanceBox[] = [];
  for (const section of scene.sections) {
    if (section.sectionId !== sectionId || section.lod === "hidden") continue;
    boxes.push({
      key: section.key,
      boardId: section.boardId,
      transform: section.transform,
      local: section.local,
      rect: section.rect,
    });
  }
  return boxes;
}

/** Instances on the gesture's board; falls back to every instance we can see. */
function onBoard(boxes: readonly InstanceBox[], boardId: string | null): InstanceBox[] {
  if (!boardId) return [...boxes];
  const matching = boxes.filter((box) => box.boardId === boardId);
  return matching.length > 0 ? matching : [...boxes];
}

/**
 * Every instance a peer has selected, including a card duplicated through a
 * portal: selection is canonical, so all copies show the peer's colour.
 */
export function peerSelectionOutlines(
  scene: Scene,
  peers: readonly PeerPresence[],
  rectFor: RectLookup,
): PeerSelectionOutline[] {
  const outlines: PeerSelectionOutline[] = [];
  for (const peer of peers) {
    const selection = peer.selection;
    if (!selection) continue;
    for (const cardId of selection.nodeIds) {
      for (const box of cardBoxes(scene, cardId)) {
        outlines.push({
          peer,
          instanceKey: box.key,
          cardId,
          sectionId: null,
          rect: rectFor(box.key, box.rect),
        });
      }
    }
    if (selection.sectionId) {
      for (const box of sectionBoxes(scene, selection.sectionId)) {
        outlines.push({
          peer,
          instanceKey: box.key,
          cardId: null,
          sectionId: selection.sectionId,
          rect: rectFor(box.key, box.rect),
        });
      }
    }
  }
  return outlines;
}

function movedRect(box: InstanceBox, x: number, y: number, width?: number, height?: number): Rect {
  return transformRect(box.transform, {
    x,
    y,
    width: width ?? box.local.width,
    height: height ?? box.local.height,
  });
}

/**
 * Ghosts for every gesture in flight. Each one is reconstructed in board space
 * from the peer's published geometry and then transformed into page space, so a
 * card living inside a scaled portal lands on the instance the peer is moving.
 */
export function peerGhosts(scene: Scene, peers: readonly PeerPresence[]): PeerGhost[] {
  const ghosts: PeerGhost[] = [];

  for (const peer of peers) {
    const dragging = peer.dragging;
    if (dragging) {
      const boardId = dragging.boardId ?? peer.board;
      const anchorBoxes = onBoard(cardBoxes(scene, dragging.nodeId), boardId);
      const anchor = anchorBoxes[0];
      const ids =
        dragging.nodeIds && dragging.nodeIds.length > 0 ? dragging.nodeIds : [dragging.nodeId];
      const dx = anchor ? dragging.position.x - anchor.local.x : 0;
      const dy = anchor ? dragging.position.y - anchor.local.y : 0;
      const gesture: PeerGhost[] = [];
      for (const cardId of ids) {
        for (const box of onBoard(cardBoxes(scene, cardId), boardId)) {
          gesture.push({
            peer,
            instanceKey: box.key,
            kind: "drag",
            rect: movedRect(box, box.local.x + dx, box.local.y + dy),
            anchor: false,
            ...(ids.length > 1 ? { detail: `${ids.length} cards` } : {}),
          });
        }
      }
      const first = gesture[0];
      if (first) {
        gesture[0] = { ...first, anchor: true };
        ghosts.push(...gesture);
      }
      continue;
    }

    const resizing = peer.resizing;
    if (resizing) {
      const boardId = resizing.boardId ?? peer.board;
      const boxes = onBoard(cardBoxes(scene, resizing.nodeId), boardId);
      boxes.forEach((box, index) => {
        ghosts.push({
          peer,
          instanceKey: box.key,
          kind: "resize",
          rect: movedRect(
            box,
            resizing.position.x,
            resizing.position.y,
            resizing.width,
            resizing.height,
          ),
          anchor: index === 0,
        });
      });
      continue;
    }

    const sectionResize = peer.sectionResize;
    if (sectionResize) {
      sectionBoxes(scene, sectionResize.sectionId).forEach((box, index) => {
        ghosts.push({
          peer,
          instanceKey: box.key,
          kind: "section-resize",
          rect: movedRect(
            box,
            sectionResize.position.x,
            sectionResize.position.y,
            sectionResize.width,
            sectionResize.height,
          ),
          anchor: index === 0,
        });
      });
      continue;
    }

    const sectionDrag = peer.sectionDrag;
    if (sectionDrag) {
      sectionBoxes(scene, sectionDrag.sectionId).forEach((box, index) => {
        ghosts.push({
          peer,
          instanceKey: box.key,
          kind: "section-drag",
          rect: movedRect(box, sectionDrag.position.x, sectionDrag.position.y),
          anchor: index === 0,
        });
      });
    }
  }

  return ghosts;
}

/** The deepest expanded portal whose frame holds `point`, if any. */
function clipPortal(scene: Scene, point: Point): PortalInstance | null {
  let found: PortalInstance | null = null;
  for (const portal of scene.portals) {
    if (!portal.expanded || portal.lod === "hidden") continue;
    if (!rectContainsPoint(portal.frame, point)) continue;
    if (!found || portal.path.length >= found.path.length) found = portal;
  }
  return found;
}

/**
 * Peer pointers as page-space dots. A dot over expanded portal content is
 * clipped to that portal's frame, so it never paints over the portal chrome;
 * a dot over a collapsed target is dropped, because that content is not shown.
 */
export function peerPointerDots(scene: Scene, peers: readonly PeerPresence[]): PeerPointerDot[] {
  const dots: PeerPointerDot[] = [];
  for (const peer of peers) {
    if (!peer.pointer) continue;
    const point = transformPoint(scene.root.transform, peer.pointer);
    const portal = clipPortal(scene, point);
    if (portal) {
      dots.push({ peer, point, clip: portal.frame });
      continue;
    }
    const hidden = scene.portals.some(
      (candidate) =>
        !candidate.expanded &&
        candidate.lod !== "hidden" &&
        rectContainsPoint(candidate.frame, point),
    );
    if (hidden) continue;
    dots.push({ peer, point, clip: null });
  }
  return dots;
}
