/**
 * Drawing a link.
 *
 * A press within a connector's hotspot starts a link instead of a card move.
 * The claim is made in the capture phase on the surface root, before ICE's own
 * listener on the desk below it, so the card is never picked up: a link drag
 * and a move cannot both start.
 *
 * One commit at pointer-up through the bridge planner, then the ordinary
 * reconcile draws it. Nothing is written while the drag is in flight; the
 * preview is a line in an inert layer, and the hover dots are a promise the
 * press keeps.
 *
 * The gesture also owns what the perspective layers need from it: whether a
 * drag is in flight (a pointer move belongs to the link, not to presence) and
 * the connector layer both of them repaint.
 */

import type { Entity } from "@vibecook/ice";
import { useEffect, useMemo, useRef } from "react";

import { usePresenceStore } from "../collab/usePresenceStore";
import { applyCanonicalWrite, planEdgeCreate, workspaceWriter } from "./iceBridge";
import {
  beginLinkDrag,
  boardAnchors,
  type ConnectorAnchor,
  connectorAnchors,
  connectorAt,
  connectSample,
  endLinkDrag,
  type LinkDragState,
  type LinkDragTarget,
  linkHotspotRadius,
  linkMinTravel,
  moveLinkDrag,
  nearestConnector,
} from "./iceLinkDrag";
import { presenceRoleCaps } from "./icePresence";
import { screenToWorld } from "./iceScreenToWorld";
import { describeError, entityAt, entityRectOf, screenPointOf } from "./iceSurfaceShared";
import { type IceSurfaceRefs, type IceWiring, resolveSurface } from "./iceSurfaceWiring";
import { createSuiteConnectorLayer } from "./suiteConnectorLayer";
import type { IceProjection } from "./useIceProjection";

/** What the rest of the surface may ask of the link gesture. */
export interface IceLinkGesture {
  /** True while a link drag owns the pointer. */
  dragging(): boolean;
  /** The gesture's share of a pointer move; true when it consumed the event. */
  move(event: PointerEvent): boolean;
  /** The pointer left the surface: drop the hover dots unless a link is in flight. */
  leave(): void;
  /** Escape asks this first: while a link is being drawn it owns the pointer. */
  cancel(): boolean;
  /** Repaint the preview and the hover dots (the camera may have moved). */
  sync(): void;
}

interface LinkHandles {
  dragging?: () => boolean;
  move?: (event: PointerEvent) => boolean;
  leave?: () => void;
  cancel?: () => boolean;
  sync?: () => void;
}

export function useIceLinkGesture(input: {
  readonly wiring: IceWiring;
  readonly refs: IceSurfaceRefs;
  readonly projection: IceProjection;
}): IceLinkGesture {
  const { wiring, refs, projection } = input;
  const handles = useRef<LinkHandles>({});

  useEffect(() => {
    const { phase, seed, layerReady, workspaceMode, liveWorkspace, rootBoardId, caps, cameraApi } =
      wiring;
    if (phase.kind !== "ready" || seed === null || layerReady === 0) return;
    if (!workspaceMode || liveWorkspace === null || rootBoardId === null) return;
    const dom = resolveSurface(refs);
    if (dom === null) return;
    const { root, desk, overlays } = dom;

    const { engine, core } = phase;
    const slots = seed.entitySlots;
    const rectOf = (entity: Entity) => entityRectOf(engine, core, entity);
    const pickEntity = (screen: { x: number; y: number }) => entityAt(desk, screen);
    const localPoint = (event: PointerEvent) => screenPointOf(root, event);
    const presence = usePresenceStore.getState();
    const roleCaps = presenceRoleCaps(caps.role);

    /* ---------------------------------------------------------------- *
     * Drawing a link
     *
     * A press within a connector's hotspot starts a link instead of a
     * card move. The claim is made in the capture phase on the surface
     * root, before ICE's own listener on the desk below it, so the card
     * is never picked up: a link drag and a move cannot both start.
     *
     * One commit at pointer-up through the bridge planner, then the
     * ordinary reconcile draws it. Nothing is written while the drag is
     * in flight; the preview is a line in an inert layer.
     * ---------------------------------------------------------------- */
    const canLink = caps.bridge.write && roleCaps.drag;
    let linkDrag: LinkDragState | null = null;
    let hover: { readonly entity: Entity; readonly anchors: readonly ConnectorAnchor[] } | null =
      null;
    let lastHoverAt = 0;

    /**
     * The anchors an entity offers a link. A card offers its connectors; a Board
     * offers the midpoints of its four walls, because a frame has no perimeter
     * to hang a connector on (ADR-0041).
     */
    const connectorsOf = (entity: Entity): ConnectorAnchor[] => {
      const rect = rectOf(entity);
      if (rect === null) return [];
      const mat = seed.boardMats.get(entity);
      if (mat !== undefined) return boardAnchors(rect);
      const slot = slots.get(entity);
      if (slot === undefined) return [];
      const card = liveWorkspace.getCard(slot.cardId);
      if (card === undefined) return [];
      return connectorAnchors(card.connectors, rect);
    };

    /** What an entity is, as a link end: a card's id, or a Board's. */
    const endOf = (entity: Entity): { id: string; kind: "card" | "board" } | null => {
      const mat = seed.boardMats.get(entity);
      if (mat !== undefined) return { id: mat.boardId, kind: "board" };
      const slot = slots.get(entity);
      return slot === undefined ? null : { id: slot.cardId, kind: "card" };
    };

    const linkLayer = createSuiteConnectorLayer({
      container: overlays,
      camera: () => cameraApi?.cameraOf() ?? null,
      anchors: () => hover?.anchors ?? [],
      drag: () =>
        linkDrag === null
          ? null
          : {
              from: linkDrag.anchor,
              pointer: linkDrag.pointer,
              target: linkDrag.target?.point ?? null,
            },
    });
    overlays.append(linkLayer.layer);

    const cancelLink = (): boolean => {
      if (linkDrag === null) return false;
      linkDrag = null;
      hover = null;
      presence.setConnect(null);
      linkLayer.sync();
      return true;
    };

    const finishLink = (): void => {
      if (linkDrag === null) return;
      const intent = endLinkDrag(linkDrag);
      linkDrag = null;
      hover = null;
      presence.setConnect(null);
      linkLayer.sync();
      if (intent === null) return;
      try {
        const plan = planEdgeCreate(intent, { capabilities: caps.bridge });
        if (plan.status === "commit") {
          applyCanonicalWrite(workspaceWriter(liveWorkspace), plan.write);
        }
      } catch (error) {
        // A refused link leaves the document untouched; the desk already
        // dropped the preview, so there is nothing to undo.
        console.warn("[ice] could not draw link", describeError(error));
      }
      projection.reconcile();
    };

    const updateLink = (
      screen: { x: number; y: number },
      world: { x: number; y: number },
    ): void => {
      if (linkDrag === null) return;
      const entity = pickEntity(screen);
      let target: LinkDragTarget | null = null;
      if (entity !== null) {
        const anchors = connectorsOf(entity);
        const end = endOf(entity);
        if (anchors.length > 0) hover = { entity, anchors };
        if (end !== null && !(end.kind === linkDrag.source.kind && end.id === linkDrag.source.id)) {
          const nearest = nearestConnector(anchors, world);
          if (nearest !== null) {
            target = {
              kind: end.kind,
              id: end.id,
              ...(end.kind === "card" ? { connectorId: nearest.connectorId } : {}),
              point: nearest.point,
            };
          }
        }
      } else if (hover !== null) {
        hover = null;
      }
      linkDrag = moveLinkDrag(linkDrag, world, target);
      presence.setConnect(connectSample(linkDrag));
      linkLayer.sync();
    };

    const onLinkDown = (event: PointerEvent): void => {
      if (event.button !== 0 || !canLink) return;
      const camera = cameraApi?.cameraOf() ?? null;
      if (camera === null) return;
      const screen = localPoint(event);
      const world = screenToWorld(screen, camera);
      // A dot sits *on* the edge, so the press can land a hair outside the
      // object: the entity under the pointer answers first, then the one the
      // dots were offered for.
      const picked = pickEntity(screen);
      const candidates = [picked, hover?.entity ?? null].filter(
        (entity): entity is Entity => entity !== null,
      );
      let started: LinkDragState | null = null;
      let startedOn: { entity: Entity; anchors: ConnectorAnchor[] } | null = null;
      for (const entity of candidates) {
        const end = endOf(entity);
        if (end === null) continue;
        const anchors = connectorsOf(entity);
        const anchor = connectorAt(anchors, world, linkHotspotRadius(camera.zoom));
        if (anchor === null) continue;
        started = beginLinkDrag({
          boardId: rootBoardId,
          id: end.id,
          kind: end.kind,
          connectorId: anchor.connectorId,
          anchor: anchor.point,
          pointer: world,
          minTravel: linkMinTravel(camera.zoom),
        });
        if (started !== null) {
          startedOn = { entity, anchors };
          break;
        }
      }
      if (started === null || startedOn === null) return;
      linkDrag = started;
      hover = startedOn;
      // Claim the press before ICE's desk sees it, and keep the moves coming
      // when the pointer leaves the surface mid-drag.
      event.preventDefault();
      event.stopPropagation();
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        // No capture available: the root's own listeners still see the drag
        // while the pointer is over it, and Escape abandons the rest.
      }
      presence.setConnect(connectSample(started));
      presence.setPointer(null);
      linkLayer.sync();
    };

    const onLinkUp = (event: PointerEvent): void => {
      if (linkDrag === null) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        root.releasePointerCapture(event.pointerId);
      } catch {
        // The capture may already be gone; releasing twice is not an error.
      }
      finishLink();
    };

    const onLinkCancel = (): void => {
      cancelLink();
    };

    /** Show a card's connectors while the pointer rests on it. */
    const updateHover = (event: PointerEvent): void => {
      // A seat that cannot draw a link is not offered one: the dots are a
      // promise the press keeps.
      if (!canLink) return;
      const now = performance.now();
      if (now - lastHoverAt < 50) return;
      lastHoverAt = now;
      // A Board mat is an end too, so the test is "can this take a link", not
      // "is this a card".
      const screen = localPoint(event);
      const entity = pickEntity(screen);
      if (entity === null && hover !== null) {
        // The dots sit on the edge, so reaching for one takes the pointer just
        // outside the object it belongs to. The offer stays while the pointer is
        // within a hotspot of it; only leaving that clears it.
        const camera = cameraApi?.cameraOf() ?? null;
        const radius = camera === null ? 0 : linkHotspotRadius(camera.zoom) * 2;
        if (
          camera !== null &&
          connectorAt(hover.anchors, screenToWorld(screen, camera), radius) !== null
        ) {
          return;
        }
      }
      if (entity === null || endOf(entity) === null) {
        if (hover !== null) {
          hover = null;
          linkLayer.sync();
        }
        return;
      }
      hover = { entity, anchors: connectorsOf(entity) };
      linkLayer.sync();
    };

    /** The panel's share of a pointer move: a link owns it, or the hover does. */
    const moveAt = (event: PointerEvent): boolean => {
      if (linkDrag !== null) {
        const camera = cameraApi?.cameraOf() ?? null;
        if (camera === null) return true;
        const screen = localPoint(event);
        updateLink(screen, screenToWorld(screen, camera));
        return true;
      }
      updateHover(event);
      return false;
    };

    /** Leaving the surface ends the offer, not the drag: a drag may pass over the shell. */
    const leaveSurface = (): void => {
      if (linkDrag === null && hover !== null) {
        hover = null;
        linkLayer.sync();
      }
    };

    handles.current = {
      dragging: () => linkDrag !== null,
      move: moveAt,
      leave: leaveSurface,
      cancel: cancelLink,
      sync: () => linkLayer.sync(),
    };

    root.addEventListener("pointerdown", onLinkDown, true);
    root.addEventListener("pointerup", onLinkUp, true);
    root.addEventListener("pointercancel", onLinkCancel, true);

    return () => {
      root.removeEventListener("pointerdown", onLinkDown, true);
      root.removeEventListener("pointerup", onLinkUp, true);
      root.removeEventListener("pointercancel", onLinkCancel, true);
      cancelLink();
      handles.current = {};
      linkLayer.dispose();
    };
  }, [wiring, refs, projection]);

  return useMemo(
    () => ({
      dragging: () => handles.current.dragging?.() ?? false,
      move: (event) => handles.current.move?.(event) ?? false,
      leave: () => handles.current.leave?.(),
      cancel: () => handles.current.cancel?.() ?? false,
      sync: () => handles.current.sync?.(),
    }),
    [],
  );
}
