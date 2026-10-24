/**
 * Peer presence: what this seat publishes about where it is and what it holds.
 *
 * Presence is published from the surface that owns the camera: a peer sample is
 * a point in the document, and only ICE knows where the document is on screen.
 * Three rules hold it together:
 *
 * - the seat's role decides what may be published (a viewer points and selects,
 *   never drags or draws a marquee);
 * - a sample is throttled to a peer redraw rate, not a frame rate;
 * - `board` stays the View so peers on one View always see each other, while
 *   `boardOf` carries the deepest Board under the pointer — the attribution a
 *   flattened View cannot express.
 *
 * The same pass paints the presence layer, repaints the connectors, and builds
 * the dev-only debug snapshot the lab reads. One clock, one projection, so what
 * this seat draws and what a peer draws cannot drift.
 *
 * What a peer's ring is drawn on comes from the frame, not from the surface's
 * spawn table: a card inside an entered Board is an entity ICE built for that
 * frame, and it says which card it is through its own face group.
 */

import { type Board, boardDepth, boardWorldRect, ownerBoardAt } from "@suite/graph";
import type { Entity } from "@vibecook/ice";
import { type RefObject, useEffect } from "react";

import { usePresenceStore } from "../collab/usePresenceStore";
import { useUiStore } from "../store/useUiStore";
import type { IceDebugSlot } from "./iceDebug";
import { buildIceDebugSnapshot, publishIceDebug, readIceOverlays } from "./iceDebug";
import { anchorWorld } from "./iceEdgeGeometry";
import { cardIdOf, frameBoardOf, identityOf, identitySlots } from "./iceEntityIdentity";
import type { IcePresenceInstance } from "./icePresence";
import { marqueeSample, pointerSample, presenceRoleCaps, selectionSample } from "./icePresence";
import { createIcePresenceLayer } from "./icePresenceLayer";
import { beginPresencePress, presenceDragFor } from "./icePresencePress";
import { screenToWorld } from "./iceScreenToWorld";
import { boardFrames, entityAt, entityRectOf, screenPointOf } from "./iceSurfaceShared";
import {
  type IceOwned,
  type IceSurfaceRefs,
  type IceWiring,
  resolveSurface,
} from "./iceSurfaceWiring";
import type { IceLinkGesture } from "./useIceLinkGesture";

export function useIcePresence(input: {
  readonly wiring: IceWiring;
  readonly refs: IceSurfaceRefs;
  readonly link: IceLinkGesture;
  readonly owned: RefObject<IceOwned>;
  readonly boardsRef: RefObject<readonly Board[]>;
  readonly portalFramesRef: RefObject<readonly { id: string; name: string }[]>;
}): void {
  const { wiring, refs, link, owned, boardsRef, portalFramesRef } = input;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the Board tree and the portal path are refs read live, never values the effect closes over.
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
    const slots = identitySlots(seed.entitySlots, world);
    const rectOf = (entity: Entity) => entityRectOf(engine, core, entity);
    const pickEntity = (screen: { x: number; y: number }) => entityAt(desk, screen);
    const localPoint = (event: PointerEvent) => screenPointOf(root, event);
    const presence = usePresenceStore.getState();
    const roleCaps = presenceRoleCaps(caps.role);

    /** Every widget in the frame the camera is inside, or none on a bare desk. */
    let activeWidgets: ReturnType<typeof core.defineQuery> | null = null;
    const widgetsInFrame = (): readonly Entity[] => {
      try {
        activeWidgets ??= core.defineQuery([core.PrefabId, core.Active]);
        return world.entities(activeWidgets);
      } catch {
        return [];
      }
    };

    /**
     * The cards ICE is drawing in this frame, read from the entities' own faces.
     * A card inside an entered Board was not necessarily spawned by this
     * surface (ICE builds the frame's inside), so iterating the seed's table
     * would ring an empty seat: the frame is what is drawn, and each entity says
     * which card it stands for.
     */
    const frameCards = (): {
      readonly entity: Entity;
      readonly cardId: string;
      readonly boardId: string;
      readonly rect: { x: number; y: number; width: number; height: number };
    }[] => {
      const cards: {
        entity: Entity;
        cardId: string;
        boardId: string;
        rect: { x: number; y: number; width: number; height: number };
      }[] = [];
      for (const entity of widgetsInFrame()) {
        const identity = cardIdOf(world, entity);
        if (identity === null) continue;
        const rect = rectOf(entity);
        if (rect === null) continue;
        cards.push({ entity, cardId: identity.cardId, boardId: identity.boardId, rect });
      }
      return cards;
    };

    const paintPointer = (event: PointerEvent): void => {
      if (!roleCaps.pointer) return;
      const camera = cameraApi?.cameraOf() ?? null;
      if (camera === null) return;
      const point = screenToWorld(localPoint(event), camera);
      presence.setPointer(pointerSample(point, camera));
      presence.setBoardOf(ownerBoardAt(boardsRef.current, rootBoardId, point));
    };

    let press: ReturnType<typeof beginPresencePress> = null;
    let pressEntity: Entity | null = null;
    let lastMarquee: { x: number; y: number; width: number; height: number } | null = null;
    let dragPublished = false;
    let watchHandle = 0;
    let lastWatchAt = 0;
    let lastPointerAt = 0;
    const PRESENCE_INTERVAL_MS = 33;

    /** The in-flight gesture pass: a drag ghost and a marquee, at peer rate. */
    const watch = (now: number): void => {
      watchHandle = requestAnimationFrame(watch);
      if (now - lastWatchAt < PRESENCE_INTERVAL_MS) return;
      lastWatchAt = now;

      if (press === null || pressEntity === null) {
        if (dragPublished) {
          dragPublished = false;
          presence.setDragging(null);
        }
      } else {
        const drag = presenceDragFor(
          press,
          rectOf(pressEntity),
          useUiStore.getState().selectedNodeIds,
        );
        if (drag !== null) {
          dragPublished = true;
          presence.setDragging(drag);
        } else if (dragPublished) {
          // The card came back to where it was pressed: the gesture is over.
          dragPublished = false;
          presence.setDragging(null);
        }
      }

      if (roleCaps.marquee) {
        const buffer = phase.engine.stack?.marqueeBuffer?.rect ?? null;
        const box =
          buffer === null
            ? null
            : marqueeSample({ x: buffer.x, y: buffer.y, width: buffer.w, height: buffer.h });
        const key = box === null ? "" : `${box.x}:${box.y}:${box.width}:${box.height}`;
        const previous =
          lastMarquee === null
            ? ""
            : `${lastMarquee.x}:${lastMarquee.y}:${lastMarquee.width}:${lastMarquee.height}`;
        if (key !== previous) {
          lastMarquee = box;
          presence.setSelectionBox(box);
        }
      }
    };

    const startWatch = (): void => {
      if (watchHandle !== 0) return;
      watchHandle = requestAnimationFrame(watch);
    };

    const onPresenceDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      // A link drag already claimed this press (its listener runs first).
      if (link.dragging()) return;
      if (!roleCaps.drag && !roleCaps.marquee) return;
      // A press is not a drag: the ghost only exists once the card moved, and
      // the watch loop is what notices that.
      startWatch();
      if (!roleCaps.drag) return;
      const entity = pickEntity(localPoint(event));
      if (entity === null) return;
      const slot = slots.get(entity);
      if (slot === undefined) return;
      press = beginPresencePress({
        cardId: slot.cardId,
        planeId: rootBoardId,
        box: rectOf(entity),
      });
      pressEntity = press === null ? null : entity;
    };

    let pointerFrame = 0;
    const onPresenceMove = (event: PointerEvent): void => {
      if (link.move(event)) return;
      if (!roleCaps.pointer || press !== null || pointerFrame !== 0) return;
      const now = performance.now();
      if (now - lastPointerAt < PRESENCE_INTERVAL_MS) return;
      lastPointerAt = now;
      // One sample per frame at most: pointermove can arrive far faster than a
      // peer can draw, and every publish is an awareness message.
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0;
        paintPointer(event);
      });
    };

    const endPresenceGesture = (): void => {
      if (dragPublished) presence.setDragging(null);
      dragPublished = false;
      press = null;
      pressEntity = null;
      if (watchHandle !== 0) {
        cancelAnimationFrame(watchHandle);
        watchHandle = 0;
      }
      if (lastMarquee !== null) {
        lastMarquee = null;
        presence.setSelectionBox(null);
      }
    };

    const onPresenceLeave = (): void => {
      // A link drag keeps its pointer state: leaving the surface is the drag
      // passing over the shell, not the reader abandoning the gesture.
      link.leave();
      presence.setPointer(null);
      presence.setBoardOf(null);
    };

    const onPresenceUp = (): void => endPresenceGesture();

    root.addEventListener("pointerdown", onPresenceDown, true);
    root.addEventListener("pointermove", onPresenceMove);
    root.addEventListener("pointerup", onPresenceUp, true);
    root.addEventListener("pointercancel", onPresenceUp, true);
    root.addEventListener("pointerleave", onPresenceLeave);

    // A selection is state, not a gesture: publish it when it changes, never on
    // a frame. A viewer keeps this bit; the ghost and the marquee are withheld.
    const unsubscribeSelection = useUiStore.subscribe((state, previous) => {
      if (
        state.selectedNodeIds === previous.selectedNodeIds &&
        state.selectedEdgeIds === previous.selectedEdgeIds
      ) {
        return;
      }
      presence.setSelection(selectionSample(state.selectedNodeIds, state.selectedEdgeIds));
    });

    /* ---------------------------------------------------------------- *
     * The presence layer
     *
     * One inert DOM layer over the desk. It is painted from the same
     * projection the peers are published through, so what this seat draws
     * and what a peer draws cannot drift. The instances are the entities
     * the desk actually holds, in board units — the camera is the only
     * thing that turns them into screen pixels.
     * ---------------------------------------------------------------- */
    const presenceLayer = createIcePresenceLayer({
      container: overlays,
      peers: () => usePresenceStore.getState().peers,
      boardId: rootBoardId,
      camera: () => cameraApi?.cameraOf() ?? null,
      instances: () => {
        const list: IcePresenceInstance[] = [];
        for (const card of frameCards()) {
          list.push({
            instanceKey: `card:${card.cardId}`,
            cardId: card.cardId,
            boardId: rootBoardId,
            rect: card.rect,
          });
        }
        return list;
      },
      boardName: (boardId) => boardsRef.current.find((board) => board.id === boardId)?.name,
      viewport: () => cameraApi?.viewportOf() ?? null,
      anchorOf: (cardId, connectorId) => {
        const placement = liveWorkspace.listPlacements().find((entry) => entry.cardId === cardId);
        if (placement === undefined) return null;
        const card = liveWorkspace.getCard(cardId);
        if (card === undefined) return null;
        return anchorWorld({
          placement: {
            x: placement.x,
            y: placement.y,
            ...(placement.width === undefined ? {} : { width: placement.width }),
            ...(placement.height === undefined ? {} : { height: placement.height }),
          },
          frames: boardFrames(boardsRef.current, placement.boardId),
          connectors: card.connectors,
          connectorId,
        });
      },
    });

    overlays.append(presenceLayer.layer);

    // 20 Hz: peers publish at roughly that rate, and a cursor that moves one
    // frame late is invisible, while a layer rebuilt every frame is not free.
    let presenceSyncHandle = 0;
    let lastPresenceSync = 0;
    const syncPresence = (now: number): void => {
      presenceSyncHandle = requestAnimationFrame(syncPresence);
      if (now - lastPresenceSync < 50) return;
      lastPresenceSync = now;
      presenceLayer.sync();
      // Connectors ride the same clock: a pan or a peer's drag moves their
      // world anchors, and a dot that lags the card is a dot that lies.
      link.sync();

      // The lab runner reads this; a production page never builds it.
      if (import.meta.env.DEV) {
        const boards = boardsRef.current;
        const slotStates: IceDebugSlot[] = [];
        const seen = new Set<Entity>();
        /**
         * A widget's Position is in the units of the frame that holds it: on the
         * plane that is world, inside a Board that is the placement's own
         * coordinates (`local`). `world` is the one the plane speaks, folded
         * back through the Board chain, so a scenario can assert either.
         */
        const describe = (entity: Entity, cardId: string, boardId: string): void => {
          if (seen.has(entity)) return;
          seen.add(entity);
          const rect = rectOf(entity);
          if (rect === null) return;
          const frame = boardWorldRect(boards, boardId);
          const framed = frameBoardOf(world, entity) !== null;
          slotStates.push({
            entity,
            cardId,
            boardId,
            local:
              framed || frame === undefined
                ? rect
                : { ...rect, x: rect.x - frame.x, y: rect.y - frame.y },
            world:
              framed && frame !== undefined
                ? { ...rect, x: rect.x + frame.x, y: rect.y + frame.y }
                : rect,
          });
        };
        // The frame's own cards first (what the reader sees), then every card
        // this surface holds — a card dropped into a Board is inside it, so it
        // is no longer a member of the frame the camera is on.
        for (const card of frameCards()) describe(card.entity, card.cardId, card.boardId);
        for (const [entity, slot] of seed.entitySlots) describe(entity, slot.cardId, slot.boardId);
        const snapshot = buildIceDebugSnapshot({
          at: now,
          camera: cameraApi?.cameraOf() ?? null,
          entered: portalFramesRef.current,
          boards: boards.flatMap((board) => {
            const world = boardWorldRect(boards, board.id);
            if (world === undefined) return [];
            return [
              {
                id: board.id,
                name: board.name,
                parentBoardId: board.parentBoardId ?? null,
                depth: boardDepth(boards, board.id),
                world,
                mat: (() => {
                  for (const [entity, entry] of seed.boardMats) {
                    if (entry.boardId === board.id) return rectOf(entity);
                  }
                  return null;
                })(),
              },
            ];
          }),
          slots: slotStates,
          edges: (owned.current.edges?.debug() ?? []).map((edge) => ({
            edgeId: edge.edgeId,
            frame: edge.frame,
            from: edge.from,
            to: edge.to,
            kind: edge.kind,
            label: edge.label,
            sourceKind: edge.sourceKind,
            targetKind: edge.targetKind,
            box: rectOf(edge.entity),
          })),
          overlays: readIceOverlays(overlays),
          peers: usePresenceStore.getState().peers,
          selection: useUiStore.getState().selectedNodeIds,
          selectedEdges: useUiStore.getState().selectedEdgeIds ?? [],
        });
        publishIceDebug(snapshot, {
          pick: (x, y) => {
            const picked = pickEntity({ x, y });
            if (picked === null) return null;
            const identity = identityOf(world, picked);
            return {
              entity: picked,
              cardId: identity.cardId,
              boardId: identity.boardId,
            };
          },
        });
      }
    };
    presenceSyncHandle = requestAnimationFrame(syncPresence);

    return () => {
      root.removeEventListener("pointerdown", onPresenceDown, true);
      root.removeEventListener("pointermove", onPresenceMove);
      root.removeEventListener("pointerup", onPresenceUp, true);
      root.removeEventListener("pointercancel", onPresenceUp, true);
      root.removeEventListener("pointerleave", onPresenceLeave);
      unsubscribeSelection();
      if (pointerFrame !== 0) cancelAnimationFrame(pointerFrame);
      endPresenceGesture();
      presence.setPointer(null);
      presence.setBoardOf(null);
      cancelAnimationFrame(presenceSyncHandle);
      presenceLayer.dispose();
    };
  }, [wiring, refs, link, owned]);
}
