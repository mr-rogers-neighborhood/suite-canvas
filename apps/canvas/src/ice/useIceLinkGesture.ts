/**
 * Drawing a link, and everything a drawn link can be asked to do.
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
 * ## The link as an object
 *
 * A drawn link is not just ink: it is selected (ICE's own `selectable`), it
 * carries a description, it can be deleted, and its ends can be adjusted. What
 * the surface has to add is the join between those facts and the document, so
 * this hook owns them all — one module, because they are one object:
 *
 * - **The document's projection.** `edge.label`, `edge.path` and
 *   `edge.bidirectional` are projected onto the `suite.edge` object's props as
 *   they change (one `setWidgetProps` per change, never per frame), which is
 *   what lets a menu edit reach the ink. The description is drawn by
 *   `suiteEdgeLabelLayer` as a screen-space chip at the middle of the ink; the
 *   header of that module says why the chip is DOM.
 * - **The right-click.** The surface's own `contextmenu` listener has no edge
 *   map (a link is not a card), so a right-click on the ink would open the canvas
 *   menu. This hook claims that event in the capture phase, resolves it through
 *   the *shared* mapping (`menuTargetFromPick` → `contextMenuStateFor`) and lets
 *   the shared builder render it — no second menu.
 * - **Delete and Backspace.** The controller deletes cards; a selected edge has
 *   no card behind it, so the key would leave the entity on the desk. One
 *   `planEdgeDelete` → one `removeEdges`, then a reconcile: the entity leaves
 *   because the document no longer has the link.
 * - **Dragging a connector along its card.** Click a connector to arm it (or
 *   use the linked menu's row), then drag it: the pointer is projected onto the
 *   card's perimeter, and one `moveConnector` lands on release.
 *
 * The gesture also owns what the perspective layers need from it: whether a
 * drag is in flight (a pointer move belongs to the link, not to presence) and
 * the connector layer both of them repaint.
 */

import type { Point, Rect } from "@suite/scene";
import { currentNavFrame, type Entity } from "@vibecook/ice";
import { useEffect, useMemo, useRef } from "react";

import { usePresenceStore } from "../collab/usePresenceStore";
import type { SelectedConnector } from "../store/useUiStore";
import { useUiStore } from "../store/useUiStore";
import {
  applyCanonicalWrite,
  applyConnectorMoveWrite,
  planConnectorMove,
  planEdgeCreate,
  planEdgeDelete,
  workspaceWriter,
} from "./iceBridge";
import {
  CONNECTOR_PART_PREFIX,
  contextMenuStateFor,
  type MenuTarget,
  menuTargetFromPick,
} from "./iceContextMenu";
import { cardIdOf, frameBoardOf, identitySlots, matBoardOf } from "./iceEntityIdentity";
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
import { connectorMagnetRadius, connectorMoveTarget } from "./suiteConnectorMove";
import {
  SUITE_EDGE_FACE,
  SUITE_EDGE_TYPE,
  type SuiteEdgeFace,
  suiteEdgeEntities,
  suiteEdgeLabelOffset,
} from "./suiteEdgeKind";
import {
  createSuiteEdgeLabelLayer,
  SUITE_EDGE_LABEL_EVENT,
  type SuiteEdgeLabelAnchor,
} from "./suiteEdgeLabelLayer";
import type { IceProjection } from "./useIceProjection";

/** What the rest of the surface may ask of the link gesture. */
export interface IceLinkGesture {
  /** True while a link drag — or a connector slide — owns the pointer. */
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

/** A connector being slid along its card's perimeter. */
interface ConnectorMove {
  readonly entity: Entity;
  readonly cardId: string;
  readonly connectorId: string;
  /** The card's box at pointer-down: the perimeter the fractions are measured on. */
  readonly rect: Rect;
  /** Where the connector sat at pointer-down, so a still slide writes nothing. */
  readonly from: Point;
  /** Where it sits now, in 0..1 fractions of `rect`. */
  readonly position: Point;
  /** The card's connectors, with the dragged one at its live point. */
  readonly anchors: readonly ConnectorAnchor[];
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
    const world = engine.world;
    // What a press can hold: the surface's own spawns, plus the entities ICE
    // built for an entered Board's frame (resolved by their own faces).
    const slots = identitySlots(seed.entitySlots, world);
    const rectOf = (entity: Entity) => entityRectOf(engine, core, entity);
    /** The Board whose inside the camera is in — the root View on the plane. */
    const activeBoard = (): string => {
      try {
        const nav = currentNavFrame(world);
        return (nav === undefined ? null : matBoardOf(world, nav)) ?? rootBoardId;
      } catch {
        // A desk without ICE's nav system has no entered frame: it is the plane.
        return rootBoardId;
      }
    };
    const pickEntity = (screen: { x: number; y: number }) => entityAt(desk, screen);
    const localPoint = (event: PointerEvent) => screenPointOf(root, event);
    const presence = usePresenceStore.getState();
    const roleCaps = presenceRoleCaps(caps.role);

    /** Is the keystroke going into text rather than at the selection? */
    const isTyping = (target: EventTarget | null): boolean => {
      if (useUiStore.getState().editingNodeId !== null) return true;
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

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
    /** A connector under the pointer's hand, being slid along its card. */
    let connectorMove: ConnectorMove | null = null;

    /**
     * The anchors an entity offers a link. A card offers its connectors; a Board
     * offers the midpoints of its four walls, because a frame has no perimeter
     * to hang a connector on (ADR-0041).
     */
    const connectorsOf = (entity: Entity): ConnectorAnchor[] => {
      const rect = rectOf(entity);
      if (rect === null) return [];
      const mat = seed.boardMats.get(entity)?.boardId ?? matBoardOf(world, entity);
      if (mat !== null) return boardAnchors(rect);
      const cardId = slots.get(entity)?.cardId ?? cardIdOf(world, entity)?.cardId;
      if (cardId === undefined) return [];
      const card = liveWorkspace.getCard(cardId);
      if (card === undefined) return [];
      return connectorAnchors(card.connectors, rect);
    };

    /** What an entity is, as a link end: a card's id, or a Board's. */
    const endOf = (entity: Entity): { id: string; kind: "card" | "board" } | null => {
      const mat = seed.boardMats.get(entity)?.boardId ?? matBoardOf(world, entity);
      if (mat !== null) return { id: mat, kind: "board" };
      const cardId = slots.get(entity)?.cardId ?? cardIdOf(world, entity)?.cardId;
      return cardId === undefined ? null : { id: cardId, kind: "card" };
    };

    /**
     * The connector a reader has taken hold of: a click on a dot arms it, and so
     * does the menu's "Reposition Connector" row. While it is armed it stays on
     * screen, because the next press on it is a slide rather than a link.
     */
    const armed = (): SelectedConnector | null => useUiStore.getState().selectedConnector;

    const armedEntity = (cardId: string): Entity | null => {
      for (const [entity, slot] of slots) {
        if (slot.cardId === cardId) return entity;
      }
      return null;
    };

    const armedAnchors = (): readonly ConnectorAnchor[] => {
      const selected = armed();
      if (selected === null) return [];
      const entity = armedEntity(selected.nodeId);
      return entity === null ? [] : connectorsOf(entity);
    };

    /**
     * Every link the desk is drawing. The kind's walk is the only thing that
     * knows which widgets are links; a desk that has not registered the kind (a
     * headless test's mock, a failed registration) draws none, and must answer
     * none rather than take the surface down with it.
     */
    const edgesOnDesk = (): readonly Entity[] => {
      try {
        return suiteEdgeEntities(world);
      } catch {
        return [];
      }
    };

    /** A drawn link's own face, if the entity is one. */
    const faceOf = (entity: Entity): SuiteEdgeFace | undefined => {
      try {
        return world.get(entity, SUITE_EDGE_FACE);
      } catch {
        return undefined;
      }
    };

    const linkLayer = createSuiteConnectorLayer({
      container: overlays,
      camera: () => cameraApi?.cameraOf() ?? null,
      // A connector being slid is offered where the hand has it, not where the
      // document still says it is: the dot under the pointer is the promise.
      anchors: () => {
        if (connectorMove !== null) return connectorMove.anchors;
        return hover?.anchors ?? armedAnchors();
      },
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

    // A description is text on a line: it has to be read at every zoom, so it is
    // screen-space DOM at the middle of the ink (`suiteEdgeLabelLayer`).
    const labelLayer = createSuiteEdgeLabelLayer({
      container: overlays,
      camera: () => cameraApi?.cameraOf() ?? null,
      labels: () => {
        const anchors: SuiteEdgeLabelAnchor[] = [];
        for (const entity of edgesOnDesk()) {
          const face = faceOf(entity);
          if (face === undefined || face.label.trim().length === 0) continue;
          const rect = rectOf(entity);
          const offset = suiteEdgeLabelOffset(world, entity);
          if (rect === null || offset === undefined) continue;
          anchors.push({
            edgeId: face.edgeId,
            label: face.label,
            point: { x: rect.x + offset.x, y: rect.y + offset.y },
          });
        }
        return anchors;
      },
    });
    overlays.append(labelLayer.layer);

    /**
     * The document's facts about a link, projected onto the object it draws.
     *
     * The desk draws a link from the props it was spawned with: the description
     * (the label layer reads it), the routing (`path` re-routes the polyline) and
     * the arrowhead (`arrow`). All three are document fields a menu edits, and
     * nothing re-spawns a drawn link when they change, so without this the
     * surface would write the document and the ink would keep the old answer
     * until a reload. One `setWidgetProps` per object per change — never per
     * frame — and only for the props that actually moved.
     */
    const projectEdges = (): void => {
      // Only the frame the camera is inside may be written: ICE refuses a prop
      // write on an object of any other frame, so projecting a link that hangs
      // on the plane while a Board is entered is not a failure to report — the
      // frame's own links are projected when the Board is left again.
      const frame = activeBoard();
      for (const entity of edgesOnDesk()) {
        if ((frameBoardOf(world, entity) ?? rootBoardId) !== frame) continue;
        const face = faceOf(entity);
        if (face === undefined) continue;
        const edge = liveWorkspace.getEdge(face.edgeId);
        if (edge === undefined) continue;
        const next: Record<string, unknown> = {};
        const label = edge.label ?? "";
        if (label !== face.label) next.label = label;
        if (edge.path !== face.path) next.path = edge.path;
        const arrow = edge.bidirectional === true;
        if (arrow !== face.arrow) next.arrow = arrow;
        if (Object.keys(next).length === 0) continue;
        try {
          engine.ops.setWidgetProps(entity, next);
        } catch (error) {
          // A refused prop write is cosmetic: the ink keeps its old label, the
          // next sync after the frame changes tries again, and a missing prop
          // is never a reason to spam a warning once per frame.
          if (import.meta.env.DEV) {
            console.debug(`[ice] link ${face.edgeId} not projected`, describeError(error));
          }
        }
      }
    };

    /** Every layer this gesture owns, on one clock (the surface calls this ~20 Hz). */
    const syncLayers = (): void => {
      projectEdges();
      linkLayer.sync();
      labelLayer.sync();
    };

    const cancelLink = (): boolean => {
      if (connectorMove === null && linkDrag === null) return false;
      linkDrag = null;
      connectorMove = null;
      hover = null;
      presence.setConnect(null);
      syncLayers();
      return true;
    };

    /**
     * The press lifted. One of three things happened: a link was drawn (one
     * `addEdge`), a connector was clicked (it is armed for the next press), or
     * nothing was asked for.
     */
    const finishLink = (): void => {
      if (linkDrag === null) return;
      const travelled =
        Math.hypot(
          linkDrag.pointer.x - linkDrag.pressed.x,
          linkDrag.pointer.y - linkDrag.pressed.y,
        ) >= linkDrag.minTravel;
      const source = linkDrag.source;
      const intent = endLinkDrag(linkDrag);
      linkDrag = null;
      hover = null;
      presence.setConnect(null);
      syncLayers();
      if (intent === null) {
        // A click on a dot, not a drag: take hold of the connector instead. The
        // dot stays offered, and the next press on it slides it (the flow
        // surface's grab handle, without a second control).
        if (!travelled && source.kind === "card" && source.connectorId !== undefined) {
          useUiStore.getState().setSelectedConnector({
            nodeId: source.id,
            connectorId: source.connectorId,
          });
          linkLayer.sync();
        }
        return;
      }
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

    /**
     * The connector being slid: the pointer is projected onto the card's own
     * perimeter, magnetised when it is already near one of the eight anchors,
     * and the dot the layer draws moves with it. The document hears nothing
     * until the release.
     */
    const updateConnectorMove = (worldPoint: Point, zoom: number): void => {
      const moving = connectorMove;
      if (moving === null) return;
      const position = connectorMoveTarget(worldPoint, moving.rect, connectorMagnetRadius(zoom));
      if (position === null) return;
      const live = {
        x: moving.rect.x + position.x * moving.rect.width,
        y: moving.rect.y + position.y * moving.rect.height,
      };
      connectorMove = {
        ...moving,
        position,
        anchors: moving.anchors.map((anchor) =>
          anchor.connectorId === moving.connectorId ? { ...anchor, point: live } : anchor,
        ),
      };
      linkLayer.sync();
    };

    /**
     * The release: one planned write, then the projection catches up. A slide
     * that lands where the connector already was is not a write at all.
     */
    const finishConnectorMove = (): void => {
      if (connectorMove === null) return;
      const move = connectorMove;
      connectorMove = null;
      const plan = planConnectorMove(
        {
          kind: "connector-move",
          cardId: move.cardId,
          connectorId: move.connectorId,
          position: move.position,
          current: move.from,
        },
        { capabilities: caps.bridge },
      );
      if (plan.status === "commit") {
        try {
          applyConnectorMoveWrite(liveWorkspace, plan.write);
        } catch (error) {
          console.warn("[ice] could not move connector", describeError(error));
        }
        projection.reconcile();
      }
      // The dots now come from the document again, at the connector's new place.
      const entity = armedEntity(move.cardId);
      if (entity !== null) hover = { entity, anchors: connectorsOf(entity) };
      syncLayers();
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
      if (event.button !== 0) return;
      // Sliding an armed connector is a move, not a link: it needs layout, while
      // drawing one needs the link capability.
      const sliding = armed() !== null && roleCaps.drag && caps.bridge.write;
      if (!canLink && !sliding) return;
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
      const hold = armed();
      let started: LinkDragState | null = null;
      let startedOn: { entity: Entity; anchors: ConnectorAnchor[] } | null = null;
      let slide: ConnectorMove | null = null;
      for (const entity of candidates) {
        const end = endOf(entity);
        if (end === null) continue;
        const anchors = connectorsOf(entity);
        const anchor = connectorAt(anchors, world, linkHotspotRadius(camera.zoom));
        if (anchor === null) continue;
        // The armed connector is what this press is for: grab it and slide it.
        if (
          hold !== null &&
          end.kind === "card" &&
          hold.nodeId === end.id &&
          hold.connectorId === anchor.connectorId
        ) {
          const rect = rectOf(entity);
          const card = liveWorkspace.getCard(end.id);
          const connector = card?.connectors.find((entry) => entry.id === anchor.connectorId);
          if (rect !== null && connector !== undefined) {
            slide = {
              entity,
              cardId: end.id,
              connectorId: anchor.connectorId,
              rect,
              from: { x: connector.x, y: connector.y },
              position: { x: connector.x, y: connector.y },
              anchors,
            };
            break;
          }
        }
        if (!canLink) continue;
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
      // A press that is not on the armed connector lets it go: taking hold of a
      // dot is a mode, and a reader who moved on to something else should not
      // find the next dot they press slides instead of drawing.
      if (slide === null && hold !== null) useUiStore.getState().setSelectedConnector(null);
      if (slide === null && (started === null || startedOn === null)) return;
      if (slide !== null) {
        connectorMove = slide;
        hover = { entity: slide.entity, anchors: slide.anchors };
      } else if (started !== null && startedOn !== null) {
        linkDrag = started;
        hover = startedOn;
      }
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
      if (started !== null) {
        presence.setConnect(connectSample(started));
        presence.setPointer(null);
      }
      syncLayers();
    };

    const onLinkUp = (event: PointerEvent): void => {
      if (linkDrag === null && connectorMove === null) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        root.releasePointerCapture(event.pointerId);
      } catch {
        // The capture may already be gone; releasing twice is not an error.
      }
      finishConnectorMove();
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

    /** The panel's share of a pointer move: a link or a connector owns it, or the hover does. */
    const moveAt = (event: PointerEvent): boolean => {
      if (linkDrag === null && connectorMove === null) {
        updateHover(event);
        return false;
      }
      const camera = cameraApi?.cameraOf() ?? null;
      if (camera === null) return true;
      const screen = localPoint(event);
      const worldPoint = screenToWorld(screen, camera);
      if (connectorMove !== null) {
        updateConnectorMove(worldPoint, camera.zoom);
        return true;
      }
      updateLink(screen, worldPoint);
      return true;
    };

    /** Leaving the surface ends the offer, not the drag: a drag may pass over the shell. */
    const leaveSurface = (): void => {
      if (linkDrag === null && connectorMove === null && hover !== null) {
        hover = null;
        syncLayers();
      }
    };

    /** The link under a screen point, or null when the pick found something else. */
    const pickEdge = (screen: {
      readonly x: number;
      readonly y: number;
    }): { entity: Entity; face: SuiteEdgeFace } | null => {
      const entity = pickEntity(screen);
      if (entity === null) return null;
      const face = faceOf(entity);
      return face === undefined ? null : { entity, face };
    };

    /**
     * The right-click targets the surface's own listener cannot see: a link (it
     * is not a card, so the surface's empty edge map makes it the canvas menu)
     * and a connector (ICE's card carries no connector part, so the pick answers
     * the card under the dot).
     *
     * Both go through the *shared* mapping — `menuTargetFromPick` decides, the
     * same builder renders — and everything else falls through untouched to the
     * surface's listener, which is why there is no second menu anywhere. The
     * claim is made in the capture phase, or the bubble listener would open the
     * card/canvas menu on the same event and win.
     */
    const onSurfaceContextMenu = (event: MouseEvent): void => {
      const screen = screenPointOf(root, event);
      const camera = cameraApi?.cameraOf() ?? null;
      const picked = pickEntity(screen);
      const slot = picked === null ? undefined : slots.get(picked);
      const face = picked === null ? undefined : faceOf(picked);
      // A connector is where the link gesture already hit-tests it: the dots
      // sit on the card's edge, so reaching for one takes the pointer outside it.
      const connector =
        picked === null || camera === null
          ? null
          : connectorAt(
              connectorsOf(picked),
              screenToWorld(screen, camera),
              linkHotspotRadius(camera.zoom),
            );

      let target: MenuTarget | null = null;
      if (picked !== null && face !== undefined) {
        target = menuTargetFromPick({
          pick: { entity: picked, type: SUITE_EDGE_TYPE },
          slots,
          pins: new Map(),
          boards: seed.boardMats,
          sections: new Map(),
          edges: new Map([[picked, { edgeId: face.edgeId, boardId: rootBoardId }]]),
        });
      } else if (picked !== null && connector !== null && slot !== undefined) {
        target = menuTargetFromPick({
          pick: {
            entity: picked,
            type: "suite.card",
            part: `${CONNECTOR_PART_PREFIX}${connector.connectorId}`,
          },
          slots,
          pins: new Map(),
          boards: seed.boardMats,
          sections: new Map(),
          edges: new Map(),
        });
      }
      if (target === null) return;

      const bounds = root.getBoundingClientRect();
      const store = useUiStore.getState();
      // The menu acts on its target, so a right-click selects it — but a
      // connector is not armed by a right-click: arming is what the "Reposition
      // Connector" row is for, and a press on an armed dot slides it.
      store.selectSection(null);
      store.setSelectedNodeIds([]);
      store.setSelectedConnector(null);
      store.setSelectedEdgeIds(target.kind === "edge" && target.edgeId ? [target.edgeId] : []);
      const view = world.getResource(core.Camera);
      store.openContextMenu(
        contextMenuStateFor({
          client: { x: event.clientX, y: event.clientY },
          container: {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
          },
          camera:
            view === undefined
              ? { x: 0, y: 0, zoom: 1 }
              : { x: view.x, y: view.y, zoom: view.zoom || 1 },
          target,
        }),
      );
      event.preventDefault();
      event.stopPropagation();
    };

    /**
     * A double click on the ink opens its description: the same editor the menu
     * row opens, asked for through one event so the input itself stays in the
     * one React component that hosts it.
     */
    const onEdgeDoubleClick = (event: MouseEvent): void => {
      const face = pickEdge(screenPointOf(root, event));
      if (face === null) return;
      const store = useUiStore.getState();
      store.selectSection(null);
      store.setSelectedNodeIds([]);
      store.setSelectedEdgeIds([face.face.edgeId]);
      event.preventDefault();
      event.stopPropagation();
      root.dispatchEvent(
        new CustomEvent(SUITE_EDGE_LABEL_EVENT, {
          bubbles: true,
          detail: { edgeId: face.face.edgeId, x: event.clientX, y: event.clientY },
        }),
      );
    };

    /**
     * Delete and Backspace, for the selection the controller cannot see.
     *
     * The surface's keymap asks the editing controller, which deletes *cards*;
     * an edge is not a card, so a selected link used to survive the key and the
     * entity stayed on the desk. One plan, one `removeEdges`, one reconcile — and
     * the surface's own handler still runs for any cards selected with it.
     */
    const onEdgeKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTyping(event.target)) return;
      const edgeIds = useUiStore.getState().selectedEdgeIds;
      if (edgeIds.length === 0) return;
      const plan = planEdgeDelete({ kind: "edge-delete", edgeIds }, { capabilities: caps.bridge });
      if (plan.status !== "commit") return;
      try {
        applyCanonicalWrite(workspaceWriter(liveWorkspace), plan.write);
      } catch (error) {
        console.warn("[ice] could not delete link", describeError(error));
        return;
      }
      useUiStore.getState().setSelectedEdgeIds([]);
      projection.reconcile();
    };

    handles.current = {
      dragging: () => linkDrag !== null || connectorMove !== null,
      move: moveAt,
      leave: leaveSurface,
      cancel: cancelLink,
      sync: syncLayers,
    };

    root.addEventListener("pointerdown", onLinkDown, true);
    root.addEventListener("pointerup", onLinkUp, true);
    root.addEventListener("pointercancel", onLinkCancel, true);
    root.addEventListener("contextmenu", onSurfaceContextMenu, true);
    root.addEventListener("dblclick", onEdgeDoubleClick, true);
    window.addEventListener("keydown", onEdgeKeyDown, true);
    syncLayers();

    return () => {
      root.removeEventListener("pointerdown", onLinkDown, true);
      root.removeEventListener("pointerup", onLinkUp, true);
      root.removeEventListener("pointercancel", onLinkCancel, true);
      root.removeEventListener("contextmenu", onSurfaceContextMenu, true);
      root.removeEventListener("dblclick", onEdgeDoubleClick, true);
      window.removeEventListener("keydown", onEdgeKeyDown, true);
      cancelLink();
      handles.current = {};
      linkLayer.dispose();
      labelLayer.dispose();
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
