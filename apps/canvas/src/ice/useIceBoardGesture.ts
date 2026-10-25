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
import { applyCanonicalWrite, ICE_WRITE_ORIGIN, workspaceWriter } from "./iceBridge";
import {
  applyClone,
  clipboardText,
  getIceClipboard,
  type IceClipboardCard,
  planCopy,
  planDuplicate,
  planPaste,
  setIceClipboard,
  workspaceCloneWriter,
} from "./iceClipboard";
import { contextMenuStateFor, type MenuPick, menuTargetFromPick } from "./iceContextMenu";
import {
  attachIcePointerEditing,
  createIceEditingController,
  currentFrameOf,
} from "./iceEditingController";
import { enteredPathOf, restoreEnteredPath } from "./iceEnteredPath";
import { identitySlots, matBoardOf } from "./iceEntityIdentity";
import { type IceNudgeCard, planNudge } from "./iceNudge";
import { pinFocusPoint, revealCamera, revealPlan } from "./iceReveal";
import { screenToWorld } from "./iceScreenToWorld";
import { setIceSelectionCommand } from "./iceSelectionCommand";
import { type IceCamera, prefersReducedMotion } from "./iceSurfaceCamera";
import { entityAt, entityRectOf, screenPointOf } from "./iceSurfaceShared";
import { deskEdgesOf } from "./iceSurfaceSpawns";
import type { IceCommands, IceOwned, IceSurfaceRefs, IceWiring } from "./iceSurfaceWiring";
import { resolveSurface } from "./iceSurfaceWiring";
import type { IceLinkGesture } from "./useIceLinkGesture";
import type { IceProjection } from "./useIceProjection";

/** Screen px a press may travel and still count as a click on a pin marker. */
export const PIN_CLICK_SLOP_PX = 4;

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
  /** What the boot owns, so a Board write can record the structure it produced. */
  readonly owned: RefObject<IceOwned>;
  readonly setPortalPath: Dispatch<SetStateAction<readonly string[]>>;
  readonly openWhiteboard: (
    cardId: string,
    box: { left: number; top: number; width: number; height: number; scale: number },
  ) => void;
}): void {
  const { wiring, refs, projection, camera, link, commands, boardsRef, owned } = input;
  const { portalDepth, portalFramesRef, setPortalPath, openWhiteboard } = input;
  // The shell's one-shot "show me this" request; consumed by the reveal effect.
  const focusTarget = useUiStore((state) => state.focusTarget);

  // `owned` is a stable ref object whose `recordStructure` the boot replaces;
  // reading it inside the effect is the point, so it is not a dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
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
    /**
     * A link that crosses a wall is drawn *inside* the Board, cut at its wall —
     * a different object, in different units, not a moved one. Every enter and
     * every exit asks the link table to re-draw, and the adoption above counts:
     * a desk restored inside a Board must open with its crossing links clipped.
     */
    const restageLinks = (): void => {
      const path = enteredPathOf(world, seed.boardMats, rootBoardId) ?? [];
      deskEdgesOf(engine)?.restage(path.map((frame) => frame.id));
    };
    restageLinks();
    // What this surface spawned, plus what a frame ICE built itself holds: a
    // press inside an entered Board lands on the latter, and the entity's own
    // face is what makes it a card there.
    const slots = identitySlots(seed.entitySlots, world);
    const rectOf = (entity: Entity) => entityRectOf(engine, core, entity);
    const pickEntity = (screen: { x: number; y: number }) => entityAt(desk, screen);

    /**
     * The pointer's last client position over this surface. A paste targets "the
     * Board the pointer is over", and the last move is the only evidence of
     * where that was; the client point is stored as-is and converted only at
     * paste time, so tracking it costs no layout read per move.
     */
    let pointerClient: { x: number; y: number } | null = null;

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
      // a resize that crossed a type rung respawns on the new kind. A Board's
      // own rect is a structural fact, so the seat that wrote it records the key
      // first — the mat is where the gesture left it, and rebuilding the desk
      // for it would respawn every card for nothing.
      afterCommit: projection.reconcile,
      afterBoardCommit: () => owned.current.recordStructure?.(),
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

    /**
     * The store and the engine both let go of the selection. Two writes because
     * there are two owners: Suite owns *what* is selected, ICE owns the `Selected`
     * tag it paints from (and mirrors back each frame).
     */
    const clearSelection = (): void => {
      const store = useUiStore.getState();
      const had =
        store.selectedNodeIds.length > 0 ||
        store.selectedEdgeIds.length > 0 ||
        store.selectedSectionId !== null ||
        store.selectedConnector !== null;
      if (had) {
        store.setSelectedNodeIds([]);
        store.setSelectedEdgeIds([]);
        store.selectSection(null);
        store.setSelectedConnector(null);
      }
      try {
        engine.ops.clearSelection();
      } catch {
        // A desk without a selection model has nothing to clear.
      }
    };

    /* ------------------------------------------------------- clipboard */

    /**
     * A Board share owns one Board and nothing else, so a paste onto another
     * Board is outside what this seat may write. An owner (`null`) may write
     * every Board; a card share never reaches here (`canCreateCards` is false).
     */
    const boardInScope = (boardId: string): boolean =>
      caps.boardIdFilter === null || caps.boardIdFilter === boardId;

    /**
     * The document's answer for a card the selection names: the Board it is
     * placed on and the position it was copied from. The seed's slot table says
     * which Board the *entity* is drawn in — the same thing — but a card can be
     * selected without the desk having drawn it (a stale store after a reseed),
     * so the placement is read from the document and the slot is only a hint.
     */
    const clipboardCardOf = (cardId: string): IceClipboardCard | null => {
      const slot = [...slots.values()].find((candidate) => candidate.cardId === cardId);
      const placement =
        (slot === undefined ? undefined : liveWorkspace.getPlacement(slot.boardId, cardId)) ??
        liveWorkspace.listCardPlacements(cardId)[0];
      if (placement === undefined) return null;
      return {
        cardId,
        boardId: placement.boardId,
        x: placement.x,
        y: placement.y,
        title: liveWorkspace.displayTitle(cardId),
      };
    };

    const clipboardCardsOf = (cardIds: readonly string[]): IceClipboardCard[] =>
      cardIds.flatMap((cardId) => {
        const card = clipboardCardOf(cardId);
        return card === null ? [] : [card];
      });

    /**
     * The selected cards as the keyboard measures them: the entity's committed
     * box (board-local, exactly what a drag would have started from).
     */
    const nudgeCardsOf = (cardIds: readonly string[]): IceNudgeCard[] => {
      const wanted = new Set(cardIds);
      const cards: IceNudgeCard[] = [];
      const seen = new Set<string>();
      for (const [entity, slot] of slots) {
        if (!wanted.has(slot.cardId) || seen.has(slot.cardId)) continue;
        const box = rectOf(entity);
        if (box === null) continue;
        seen.add(slot.cardId);
        cards.push({
          cardId: slot.cardId,
          boardId: slot.boardId,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
      }
      return cards;
    };

    /**
     * Copy: no write, so it only needs a seat that could paste. A viewer copies
     * nothing — a buffer it can never use would be a lie about what the seat can
     * do. The OS clipboard gets the titles as plain text, best effort: a courtesy
     * for pasting into another app, never the mechanism.
     */
    const copySelection = (): void => {
      const copied = planCopy({
        cards: clipboardCardsOf(useUiStore.getState().selectedNodeIds),
        capabilities: { select: caps.bridge.select, write: caps.canCreateCards },
      });
      if (copied === null) return;
      setIceClipboard(copied);
      const text = clipboardText(copied);
      try {
        const write = navigator.clipboard?.writeText(text);
        if (write !== undefined) void write.catch(() => undefined);
      } catch {
        // No clipboard permission, an insecure context, or no clipboard at all:
        // the document copy already happened, which is the one that matters.
      }
    };

    /**
     * Where a paste lands: the Board under the pointer, in that Board's units.
     *
     * Over a mat, the paste goes *into* that Board — the same assumption a drop
     * makes — and the pointer's frame-local point is shifted by the mat's own
     * origin. Anywhere else it lands on the frame the camera is inside, which is
     * the root View on the plane. With no pointer yet (a keyboard paste on a
     * fresh mount) the middle of the viewport stands in for "here".
     */
    const pasteTarget = (): { boardId: string; x: number; y: number } | null => {
      const frame = currentFrameOf(rootBoardId, portalFramesRef.current);
      const screen =
        pointerClient === null
          ? (() => {
              try {
                const viewport = engine.world.getResource(core.Viewport);
                return viewport === undefined ? null : { x: viewport.w / 2, y: viewport.h / 2 };
              } catch {
                return null;
              }
            })()
          : screenPointOf(root, {
              clientX: pointerClient.x,
              clientY: pointerClient.y,
            });
      if (screen === null) return null;
      const cameraNow = cameraOf();
      const point =
        cameraNow === null
          ? screenToWorld(screen)
          : screenToWorld(screen, { x: cameraNow.x, y: cameraNow.y, zoom: cameraNow.zoom });
      if (pointerClient !== null) {
        const entity = entityAt(desk, screen);
        const mat = entity === null ? undefined : seed.boardMats.get(entity);
        if (entity !== null && mat !== undefined) {
          let geometry:
            | { centre?: readonly [number, number]; half?: readonly [number, number] }
            | undefined;
          try {
            geometry = desk.geometryOf(entity) as typeof geometry;
          } catch {
            geometry = undefined;
          }
          if (geometry?.centre !== undefined && geometry.half !== undefined) {
            const origin = {
              x: geometry.centre[0] - Math.abs(geometry.half[0]),
              y: geometry.centre[1] - Math.abs(geometry.half[1]),
            };
            return { boardId: mat.boardId, x: point.x - origin.x, y: point.y - origin.y };
          }
        }
      }
      return { boardId: frame.boardId, x: point.x, y: point.y };
    };

    commands.current = {
      undo: () => {
        liveWorkspace.undo();
        projection.reconcile();
      },
      redo: () => {
        liveWorkspace.redo();
        projection.reconcile();
      },
      /**
       * PRODUCT DECISION — what Delete means here.
       *
       * A card is a document object with an inbox, so taking it off a Board is
       * recoverable (the card is still in the workspace, still in the library,
       * one drag from being placed again) and trashing it is not. The flow
       * surface got this right by accident of shape — Delete unplaced, and
       * Shift+Delete was the explicit destructive key — and the ICE port
       * inverted it. It is inverted back: **Delete/Backspace remove the
       * selection from the Board it is on** (one `unplaceCard` per card, no
       * trash, nothing lost), and **Shift+Delete is the only key that trashes**
       * (`trashSelection`, below). The menu says the same thing in words:
       * "Remove from board" and "Move to trash".
       */
      deleteSelection: () => {
        // A viewer, or a seat whose share does not cover layout, writes nothing.
        if (!caps.canWriteLayout) return;
        const selected = useUiStore.getState().selectedNodeIds;
        if (selected.length === 0) return;
        // Unplace from the Board each card is actually on: the frame the camera
        // is inside is the fallback, and a card inside a nested Board names its
        // own placement through the seed.
        const frameBoard = currentFrameOf(rootBoardId, portalFramesRef.current).boardId;
        for (const cardId of selected) {
          let boardId = frameBoard;
          for (const [, slot] of seed.entitySlots) {
            if (slot.cardId === cardId) {
              boardId = slot.boardId;
              break;
            }
          }
          liveWorkspace.unplaceCard(boardId, cardId);
        }
        clearSelection();
        projection.reconcile();
      },
      /** Shift+Delete: the explicit, destructive key. One planned delete write. */
      trashSelection: () => {
        if (!caps.canWriteLayout) return;
        const selected = useUiStore.getState().selectedNodeIds;
        if (selected.length === 0) return;
        controller.deleteSelection(selected);
        clearSelection();
      },
      /**
       * Cmd/Ctrl+C — remember the selection. Cmd/Ctrl+X is a copy followed by
       * the recoverable removal Delete performs (the card stays in the
       * workspace), so a cut is undoable in one step and loses nothing.
       */
      copy: copySelection,
      cut: () => {
        if (!caps.canCreateCards) return;
        copySelection();
        commands.current?.deleteSelection();
      },
      /**
       * Cmd/Ctrl+V — clone the buffer onto the Board under the pointer. One
       * commit for the whole paste: `applyClone` opens one batch and the
       * document's own copy-with-content lands inside it.
       */
      paste: () => {
        const copied = getIceClipboard();
        if (copied === null) return;
        const target = pasteTarget();
        if (target === null || !boardInScope(target.boardId)) return;
        const plan = planPaste({
          clipboard: copied,
          target,
          capabilities: { select: caps.bridge.select, write: caps.canCreateCards },
        });
        if (plan.status !== "commit") return;
        const created = applyClone(
          workspaceCloneWriter(liveWorkspace),
          plan.write,
          `${ICE_WRITE_ORIGIN}:paste`,
        );
        if (created.length === 0) return;
        projection.reconcile();
      },
      /**
       * Cmd/Ctrl+D — a copy of each selected card, down-right of itself, on the
       * Board it already lives on. One commit for the selection, like a paste;
       * the copy carries the title and the body, because it is the document
       * copying its own trees.
       */
      duplicate: () => {
        const cards = clipboardCardsOf(useUiStore.getState().selectedNodeIds).filter((card) =>
          boardInScope(card.boardId),
        );
        const plan = planDuplicate({
          cards,
          capabilities: { select: caps.bridge.select, write: caps.canCreateCards },
        });
        if (plan.status !== "commit") return;
        const created = applyClone(
          workspaceCloneWriter(liveWorkspace),
          plan.write,
          `${ICE_WRITE_ORIGIN}:duplicate`,
        );
        if (created.length === 0) return;
        projection.reconcile();
      },
      /**
       * Arrow keys — the same `planMoveCommit` a drag commits, one write per
       * press. `caps.bridge` is the layout capability the controller uses, so a
       * seat that cannot drag cannot nudge either.
       */
      nudge: (dx, dy) => {
        const cards = nudgeCardsOf(useUiStore.getState().selectedNodeIds).filter((card) =>
          boardInScope(card.boardId),
        );
        if (cards.length === 0) return;
        const plan = planNudge({ cards, delta: { x: dx, y: dy }, capabilities: caps.bridge });
        if (plan.status !== "commit") return;
        applyCanonicalWrite(workspaceWriter(liveWorkspace), plan.write);
        projection.reconcile();
      },
      reconcile: projection.reconcile,
      /**
       * The menu wrote a Board's own fact. The face already shows it (the pill
       * reads the name, the vinyl reads the colour), so the seat records the
       * structure it produced and nothing rebuilds.
       */
      noteBoardWrite: () => owned.current.recordStructure?.(),
      /**
       * Escape is a ladder, innermost first: abandon the gesture that owns the
       * pointer, leave the Board the camera is inside, and — with nothing else
       * to exit — let go of the selection. A context menu or the full-canvas
       * focus surface owns its own Escape, so this press is left to them.
       */
      escape: () => {
        const store = useUiStore.getState();
        if (store.contextMenu !== null || store.cardFocusId !== null) return;
        // A link drag is the first thing Escape abandons: it owns the pointer.
        if (link.cancel()) return;
        // Escape is the return gesture: out of a mat before out of a gesture.
        if (portalDepth.current > 0) {
          try {
            engine.ops.exitContainer();
            portalDepth.current -= 1;
            portalFramesRef.current = portalFramesRef.current.slice(0, -1);
            setPortalPath((path) => path.slice(0, -1));
            // Out on the plane, a crossing link is drawn on its own again.
            restageLinks();
          } catch {
            // A refused exit leaves the camera where it is.
          }
          return;
        }
        engine.ops.cancelActiveGestures();
        clearSelection();
      },
      zoomBy: camera.zoomBy,
      fitView: projection.fitView,
    };

    /**
     * The shell's half of the selection: a menu row writes the store, and this
     * makes ICE agree so the next frame's mirror does not disagree with it.
     * Registered for `IceContextMenu`, which is a sibling component with no
     * reference to this engine.
     */
    setIceSelectionCommand((cardIds) => {
      const entities: Entity[] = [];
      for (const cardId of cardIds) {
        for (const [entity, slot] of slots) {
          if (slot.cardId === cardId) {
            entities.push(entity);
            break;
          }
        }
      }
      try {
        engine.ops.setSelection(entities);
      } catch {
        // A refused selection is repaired by the next pick; never a crash.
      }
    });

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
          // Entering a Board is a camera flight inside ICE. A reader who asked
          // for reduced motion gets the destination without the travel — the
          // same rule `flyTo` applies to every journey (ADR-0037 §6).
          if (prefersReducedMotion()) engine.ops.enterContainer(entity, { transition: "none" });
          else engine.ops.enterContainer(entity);
          portalDepth.current += 1;
          portalFramesRef.current = [
            ...portalFramesRef.current,
            { id: mat.boardId, name: mat.title },
          ];
          setPortalPath((path) => [...path, mat.title]);
          // Links that leave this Board are drawn inside it from here on.
          restageLinks();
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

    /**
     * A pin marker is a place on the desk, and a click on one goes there. The
     * marker is drawn by the GPU (`suite.pin`) with a screen-space label, so
     * there is no DOM element to press: the pick says which pin was hit, and the
     * document says where it is. Navigation only — the camera, never a write.
     *
     * A press that travelled is a pin *drag* (the controller moves it), not a
     * click on it, so the pointer's start is kept and compared.
     */
    let pressedAt: { x: number; y: number } | null = null;
    const onPinPointerDown = (event: PointerEvent): void => {
      pressedAt = { x: event.clientX, y: event.clientY };
    };
    const onPinClick = (event: MouseEvent): void => {
      const from = pressedAt;
      pressedAt = null;
      if (from === null || event.button !== 0) return;
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) > PIN_CLICK_SLOP_PX) return;
      const bounds = root.getBoundingClientRect();
      let picked: Entity | null = null;
      try {
        picked =
          desk.pick({ x: event.clientX - bounds.left, y: event.clientY - bounds.top })?.entity ??
          null;
      } catch {
        picked = null;
      }
      const point = pinFocusPoint({
        entity: picked,
        pinEntities: seed.pinEntities,
        pinOf: (pinId) => liveWorkspace.getPin(pinId),
      });
      if (point === null) return;
      // The shell already owns "go to this pin" from the library list; a marker
      // click is the same request, so it rides the same one-shot.
      useUiStore.getState().focusPinAt(point);
    };
    root.addEventListener("pointerdown", onPinPointerDown, true);
    root.addEventListener("click", onPinClick);
    // Where the pointer is, for the one command that needs a place rather than a
    // selection: a paste lands on the Board the pointer is over. A capture-phase
    // listener sees the move even when a card's own handler stops it.
    const onTrackPointer = (event: PointerEvent): void => {
      pointerClient = { x: event.clientX, y: event.clientY };
    };
    root.addEventListener("pointermove", onTrackPointer, true);

    return () => {
      root.removeEventListener("dblclick", onDouble);
      root.removeEventListener("contextmenu", onContextMenu);
      root.removeEventListener("pointerdown", onPinPointerDown, true);
      root.removeEventListener("click", onPinClick);
      root.removeEventListener("pointermove", onTrackPointer, true);
      setIceSelectionCommand(null);
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

  /**
   * "Reveal this" from the shell — the inspector's focus action, a link to a
   * card, a search result. `focusTarget` is one-shot (a nonce, so asking twice
   * moves twice), and this is its only consumer on the canvas: the camera flies
   * to the object, entering the Boards it is nested in on the way.
   *
   * A target the desk does not hold is cleared rather than chased: an inbox
   * card, a trashed card or a Board a peer has not drawn yet has nothing to
   * frame, and a reveal that silently does nothing is better than one that
   * flies to a stale rectangle.
   */
  useEffect(() => {
    if (focusTarget === null) return;
    const { phase, seed, workspaceMode, liveWorkspace, rootBoardId, cameraApi, flyTo } = wiring;
    if (phase.kind !== "ready" || seed === null || !workspaceMode) return;
    if (liveWorkspace === null || rootBoardId === null || cameraApi === null) return;
    const dom = resolveSurface(refs);
    if (dom === null) return;
    const { engine } = phase;
    const store = useUiStore.getState();
    const plan = revealPlan({
      target: focusTarget,
      rootBoardId,
      mats: seed.boardMats,
      slots: seed.entitySlots,
    });
    if (plan === null) {
      store.clearFocusTarget();
      return;
    }

    // Stand where the object lives: leave whatever Board is entered and walk the
    // plan's chain, outermost first. A restore that cannot reach the frame means
    // the object is not where the seed says it is, so the request is dropped.
    const standing = (enteredPathOf(engine.world, seed.boardMats, rootBoardId) ?? []).map(
      (frame) => frame.id,
    );
    if (standing.join("/") !== plan.path.join("/")) {
      if (standing.length > 0) {
        try {
          engine.ops.exitTo(0, { transition: "none" });
        } catch {
          // A refused exit leaves the camera where it is; the check below says so.
        }
      }
      restoreEnteredPath(engine, seed.boardMats, plan.path);
      const adopted = enteredPathOf(engine.world, seed.boardMats, rootBoardId) ?? [];
      portalDepth.current = adopted.length;
      portalFramesRef.current = adopted;
      setPortalPath(adopted.map((frame) => frame.name));
      deskEdgesOf(engine)?.restage(adopted.map((frame) => frame.id));
      if (adopted.map((frame) => frame.id).join("/") !== plan.path.join("/")) {
        store.clearFocusTarget();
        return;
      }
    }

    // The box is read in the frame the camera is inside now: geometry is
    // frame-local, exactly as a gesture measures it.
    let geometry:
      | { centre?: readonly [number, number]; half?: readonly [number, number] }
      | undefined;
    try {
      geometry = dom.desk.geometryOf(plan.entity) as typeof geometry;
    } catch {
      geometry = undefined;
    }
    if (geometry?.centre === undefined || geometry.half === undefined) {
      store.clearFocusTarget();
      return;
    }
    const halfWidth = Math.abs(geometry.half[0]);
    const halfHeight = Math.abs(geometry.half[1]);
    const camera = revealCamera({
      rect: {
        x: geometry.centre[0] - halfWidth,
        y: geometry.centre[1] - halfHeight,
        width: halfWidth * 2,
        height: halfHeight * 2,
      },
      viewport: cameraApi.viewportOf(),
    });
    if (camera !== null) flyTo(camera);
    store.clearFocusTarget();
  }, [focusTarget, wiring, refs, portalDepth, portalFramesRef, setPortalPath]);
}
