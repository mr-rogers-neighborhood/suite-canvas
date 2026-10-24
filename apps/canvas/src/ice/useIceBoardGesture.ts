/**
 * The desk's gestures: the editing controller, the keymap's commands, entering a
 * Board, and the shell's context menu.
 *
 * This is the only place a gesture becomes a document write: the controller
 * commits one canonical write per gesture through the bridge, and the
 * projection reconciles afterwards. ICE's own history is never read — undo and
 * redo are Loro's.
 *
 * A Board is a doorway rather than a different surface: a double click moves
 * the camera inside the frame, and Escape walks back out. The path is kept here
 * because it is the one piece of navigation state the HUD breadcrumb shows.
 */

import type { Board } from "@suite/graph";
import type { Entity } from "@vibecook/ice";
import { type Dispatch, type RefObject, type SetStateAction, useEffect } from "react";
import { isWhiteboardCard } from "../cards/whiteboard";
import { useUiStore } from "../store/useUiStore";
import { workspaceWriter } from "./iceBridge";
import { contextMenuStateFor, type MenuPick, menuTargetFromPick } from "./iceContextMenu";
import {
  attachIcePointerEditing,
  createIceEditingController,
  currentFrameOf,
} from "./iceEditingController";
import { enteredPathOf } from "./iceEnteredPath";
import { identitySlots, matBoardOf } from "./iceEntityIdentity";
import type { IceCamera } from "./iceSurfaceCamera";
import { entityAt, entityRectOf } from "./iceSurfaceShared";
import type { IceCommands, IceSurfaceRefs, IceWiring } from "./iceSurfaceWiring";
import { resolveSurface } from "./iceSurfaceWiring";
import type { IceLinkGesture } from "./useIceLinkGesture";
import type { IceProjection } from "./useIceProjection";

export function useIceBoardGesture(input: {
  readonly wiring: IceWiring;
  readonly refs: IceSurfaceRefs;
  readonly projection: IceProjection;
  readonly camera: IceCamera;
  readonly link: IceLinkGesture;
  readonly commands: RefObject<IceCommands | null>;
  readonly boardsRef: RefObject<readonly Board[]>;
  readonly portalDepth: RefObject<number>;
  readonly portalFramesRef: RefObject<readonly { id: string; name: string }[]>;
  readonly setPortalPath: Dispatch<SetStateAction<readonly string[]>>;
  readonly openWhiteboard: (
    cardId: string,
    box: { left: number; top: number; width: number; height: number; scale: number },
  ) => void;
}): void {
  const { wiring, refs, projection, camera, link, commands, boardsRef } = input;
  const { portalDepth, portalFramesRef, setPortalPath, openWhiteboard } = input;

  useEffect(() => {
    const { phase, seed, layerReady, workspaceMode, liveWorkspace, rootBoardId, caps, cameraApi } =
      wiring;
    if (phase.kind !== "ready" || seed === null || layerReady === 0) return;
    if (!workspaceMode || liveWorkspace === null || rootBoardId === null) return;
    const dom = resolveSurface(refs);
    if (dom === null) return;
    const { root, desk } = dom;

    const { engine, core } = phase;
    const world = engine.world;
    /**
     * A reload inside a Board is restored into the engine by the boot, before
     * the first paint. The path this hook keeps for Escape, the breadcrumb and
     * the debug snapshot still starts empty, so adopt ICE's nav once here —
     * entering again would reframe the camera the document just restored.
     */
    const adopted = enteredPathOf(world, seed.boardMats, rootBoardId) ?? [];
    portalDepth.current = adopted.length;
    portalFramesRef.current = adopted;
    if (adopted.length > 0) setPortalPath(adopted.map((frame) => frame.name));
    // What this surface spawned, plus what a frame ICE built itself holds: a
    // press inside an entered Board lands on the latter, and the entity's own
    // face is what makes it a card there.
    const slots = identitySlots(seed.entitySlots, world);
    const rectOf = (entity: Entity) => entityRectOf(engine, core, entity);
    const pickEntity = (screen: { x: number; y: number }) => entityAt(desk, screen);

    /** One camera convention, and it is ICE's: see `useIceCamera`. */
    const cameraOf = () => cameraApi?.cameraOf() ?? null;

    const removeEntities = (entities: readonly Entity[]) => {
      if (entities.length === 0) return;
      try {
        engine.ops.setSelection(entities);
        engine.ops.deleteSelection();
      } catch {
        // A refused removal is repaired by the next reconcile.
      }
    };

    const controller = createIceEditingController({
      camera: cameraOf,
      pick: pickEntity,
      rectOf,
      writer: workspaceWriter(liveWorkspace),
      role: caps.controllerRole,
      removeCards: (cardIds) => {
        const entities = [...seed.entitySlots]
          .filter(([, slot]) => cardIds.includes(slot.cardId))
          .map(([entity]) => entity);
        removeEntities(entities);
        for (const [entity, slot] of [...seed.entitySlots]) {
          if (cardIds.includes(slot.cardId)) seed.entitySlots.delete(entity);
        }
      },
      slots,
      rootBoardId,
      // ICE measures every box in the frame the camera is inside, so a gesture
      // inside an entered Board carries that Board and its path.
      currentFrame: () => currentFrameOf(rootBoardId, portalFramesRef.current),
      // A drop is the one gesture that changes which Board a placement belongs
      // to: ICE re-parents the entity into the container's frame, and the
      // container's `ChildOf` parent is the mat it landed on.
      containerOf: (entity) => {
        try {
          // The controller carries an entity as a plain number; ICE brands the same id.
          const parent = engine.world.getRelation(entity as Entity, core.ChildOf);
          const landed =
            parent === undefined
              ? undefined
              : (seed.boardMats.get(parent)?.boardId ?? matBoardOf(world, parent));
          if (landed === undefined) return null;
          // A mat for a Board the workspace no longer holds is not a target.
          return boardsRef.current.some((board) => board.id === landed) ? landed : null;
        } catch {
          return null;
        }
      },
      selection: () => useUiStore.getState().selectedNodeIds,
      // A gesture commits into Loro, then reconcile brings the projection to
      // the new truth: a moved card is already where it was left (a no-op), and
      // a resize that crossed a type rung respawns on the new kind.
      afterCommit: projection.reconcile,
      pinSlots: new Map([...seed.pinEntities].map(([pinId, entity]) => [entity, pinId])),
      movePin: (pinId, point) => {
        liveWorkspace.movePin(pinId, point);
      },
      // A mat drag or handle writes the Board's rect, not a card placement.
      boardSlots: new Map(
        [...seed.boardMats].map(([entity, mat]) => [
          entity,
          { boardId: mat.boardId, parentBoardId: mat.parentBoardId },
        ]),
      ),
    });

    commands.current = {
      undo: () => {
        liveWorkspace.undo();
        projection.reconcile();
      },
      redo: () => {
        liveWorkspace.redo();
        projection.reconcile();
      },
      deleteSelection: () => {
        controller.deleteSelection(useUiStore.getState().selectedNodeIds);
      },
      reconcile: projection.reconcile,
      escape: () => {
        // A link drag is the first thing Escape abandons: it owns the pointer.
        if (link.cancel()) return;
        // Escape is the return gesture: out of a mat before out of a gesture.
        if (portalDepth.current > 0) {
          try {
            engine.ops.exitContainer();
            portalDepth.current -= 1;
            portalFramesRef.current = portalFramesRef.current.slice(0, -1);
            setPortalPath((path) => path.slice(0, -1));
          } catch {
            // A refused exit leaves the camera where it is.
          }
          return;
        }
        engine.ops.cancelActiveGestures();
      },
      zoomBy: camera.zoomBy,
      fitView: projection.fitView,
    };

    const detach = attachIcePointerEditing(root, controller);

    // A mini mat is a doorway: a double click moves the camera inside it rather
    // than swapping boards. ICE owns the flight and the frame; this only routes
    // the press and remembers the path for Escape and the breadcrumb.
    const onDouble = (event: MouseEvent): void => {
      const bounds = root.getBoundingClientRect();
      const screen = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      let picked: Entity | null = null;
      try {
        picked = desk.pick(screen)?.entity ?? null;
      } catch {
        picked = null;
      }
      if (picked === null) return;
      const entity = picked;
      const mat = seed.boardMats.get(entity);
      if (mat !== undefined) {
        try {
          engine.ops.enterContainer(entity);
          portalDepth.current += 1;
          portalFramesRef.current = [
            ...portalFramesRef.current,
            { id: mat.boardId, name: mat.title },
          ];
          setPortalPath((path) => [...path, mat.title]);
        } catch {
          // A refused entry leaves the camera where it is.
        }
        return;
      }
      // A whiteboard card opens its editor on a double click. Hover is not
      // consent: mounting the drawing surface because the pointer rested on a
      // card covers the board with Excalidraw's chrome, which is not what a
      // reader asked for.
      const slot = slots.get(entity);
      const card = slot === undefined ? undefined : liveWorkspace.getCard(slot.cardId);
      if (slot === undefined || card === undefined || !isWhiteboardCard(card)) return;
      const geometry = desk.geometryOf(entity) as
        | { centre?: readonly [number, number]; half?: readonly [number, number] }
        | undefined;
      const view = engine.world.getResource(core.Camera);
      if (geometry?.centre === undefined || geometry.half === undefined || view === undefined)
        return;
      const zoom = Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1;
      const worldWidth = Math.abs(geometry.half[0]) * 2;
      const worldHeight = Math.abs(geometry.half[1]) * 2;
      openWhiteboard(slot.cardId, {
        left: (geometry.centre[0] - view.x) * zoom - (worldWidth * zoom) / 2,
        top: (geometry.centre[1] - view.y) * zoom - (worldHeight * zoom) / 2,
        width: worldWidth * zoom,
        height: worldHeight * zoom,
        scale: zoom,
      });
    };
    root.addEventListener("dblclick", onDouble);

    // A right-click is the shell's menu, opened on whatever the pick found. The
    // mapping lives in `iceContextMenu`; this only supplies the pick, the
    // camera and the entity maps the surface already keeps.
    const pinSlots = new Map([...seed.pinEntities].map(([pinId, entity]) => [entity, pinId]));
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
      const bounds = root.getBoundingClientRect();
      let pick: MenuPick | null = null;
      try {
        pick = desk.pick({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      } catch {
        pick = null;
      }
      const target = menuTargetFromPick({
        pick:
          pick === null
            ? null
            : {
                entity: pick.entity,
                type: pick.type,
                ...(pick.part === undefined ? {} : { part: pick.part }),
              },
        slots,
        pins: pinSlots,
        boards: seed.boardMats,
        sections: new Map(),
        edges: new Map(),
      });
      const store = useUiStore.getState();
      // The menu acts on the selection, so a right-click selects what it hit.
      if (target?.kind === "node") {
        const cardId = target.cardId;
        if (cardId !== undefined && !store.selectedNodeIds.includes(cardId)) {
          store.selectSection(null);
          store.setSelectedNodeIds([cardId]);
        }
      } else if (target?.kind === "board") {
        // A mat is a Board: selecting it selects the frame it stands for.
        store.selectSection(target.boardId ?? null);
        store.setSelectedNodeIds([]);
      } else if (target?.kind === "section") {
        store.selectSection(target.sectionId ?? null);
      } else if (target?.kind === "edge") {
        store.selectSection(null);
        store.setSelectedNodeIds([]);
        store.setSelectedEdgeIds(target.edgeId === undefined ? [] : [target.edgeId]);
      } else {
        store.selectSection(null);
        store.setSelectedNodeIds([]);
        store.setSelectedEdgeIds([]);
      }
      const view = engine.world.getResource(core.Camera);
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
    };
    root.addEventListener("contextmenu", onContextMenu);

    return () => {
      root.removeEventListener("dblclick", onDouble);
      root.removeEventListener("contextmenu", onContextMenu);
      detach();
      controller.cancel();
      commands.current = null;
      portalDepth.current = 0;
      portalFramesRef.current = [];
      setPortalPath([]);
    };
  }, [
    wiring,
    refs,
    projection,
    camera,
    link,
    commands,
    boardsRef,
    portalDepth,
    portalFramesRef,
    setPortalPath,
    openWhiteboard,
  ]);
}
