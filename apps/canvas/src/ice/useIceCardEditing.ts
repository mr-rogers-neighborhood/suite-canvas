/**
 * The canvas editor's lifecycle: one `NodeCard`, over one card, while the UI
 * store says a canvas edit is open.
 *
 * The *state* is the UI store's (`editingNodeId` / `editingField` /
 * `editingSurface`), not this hook's: the shell already owns that protocol
 * (`App.createCard` calls `startEditing`, the inspector uses the same fields with
 * its own surface), and one owner is what makes "never two editors" true by
 * construction. This hook is the wire between that state and the desk:
 *
 * - **opening** — a double click, Enter with one card selected, or the store
 *   itself (the card the Dock just made). Every path runs the same gate
 *   (`planCardEditor`): a viewer, a card outside the share's scope, a trashed or
 *   missing card and a whiteboard open nothing, and a *gesture* on a card below
 *   the readable width opens nothing either.
 * - **placing** — a per-frame tracker reads the entity's box and the camera of
 *   the frame it lives in, so the editor stays glued through a zoom or a pan and
 *   follows a card whose rung grew under it. Only a changed box writes a style,
 *   so a still camera costs one comparison per frame and no paint.
 * - **closing** — blur, Escape, a selection that no longer holds the card, a
 *   Board being entered, the card leaving the document, or the desk tearing
 *   down. Every close flushes the commit window first.
 */

import type { Entity } from "@vibecook/ice";
import { createElement, type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../canvas/multiSelect";
import { isWhiteboardCard } from "../cards/whiteboard";
import { getSession } from "../session/session";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { IceCardEditorOverlay } from "./IceCardEditor";
import {
  activeCardEditor,
  attachCardEditorOpeners,
  cardEditorBox,
  createTextCommitBarrier,
  type IceCardEditingField,
  type IceCardEditorBox,
  type IceCardEditorDecision,
  type IceCardEditorOpeners,
  type IceCardEditorTarget,
  planCardEditor,
} from "./iceCardEditor";
import { identityOf } from "./iceEntityIdentity";
import { entityAt, entityRectOf } from "./iceSurfaceShared";
import {
  type IceCommands,
  type IceSurfaceRefs,
  type IceWiring,
  resolveSurface,
} from "./iceSurfaceWiring";
import type { SuiteCardCamera, SuiteCardGeometry } from "./suiteCardOverlay";
import "./iceCardEditor.css";

export interface IceCardEditing {
  /** The mounted editor, positioned over its sheet; `null` when none is open. */
  readonly editor: ReactNode;
  /** Open a card's editor through the UI store (the openers call this). */
  open(cardId: string, field?: IceCardEditingField): void;
  /** Flush, then close. */
  close(): void;
  /** The card being edited, or `null`. */
  readonly cardId: string | null;
}

export function useIceCardEditing(input: {
  readonly wiring: IceWiring;
  readonly refs: IceSurfaceRefs;
  readonly commands: { readonly current: IceCommands | null };
  /**
   * The Board path the camera is inside, outermost first. Entering one changes
   * the units the editor is measured in, so it ends the session.
   */
  readonly framePath?: readonly string[] | undefined;
  /** Opens the one whiteboard stage: the two editors never coexist. */
  readonly closeWhiteboard?: (() => void) | undefined;
}): IceCardEditing {
  const { wiring, refs, commands, closeWhiteboard } = input;
  const frameKey = (input.framePath ?? []).join("\u001f");
  const editingNodeId = useUiStore((state) => state.editingNodeId);
  const editingField = useUiStore((state) => state.editingField);
  const editingSurface = useUiStore((state) => state.editingSurface);
  const canEditContent = useUiStore((state) => state.canEditContent);
  const snapshot = useWorkspaceSnapshot();

  const active = useMemo(
    () => activeCardEditor({ editingNodeId, editingField, editingSurface, canEditContent }),
    [editingNodeId, editingField, editingSurface, canEditContent],
  );

  const boxRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const lastBox = useRef<IceCardEditorBox | null>(null);

  /** The desk, the engine and the card tables this hook reads each frame. */
  const scene = useMemo(() => {
    const phase = wiring.phase;
    const seed = wiring.seed;
    if (phase.kind !== "ready" || seed === null || wiring.liveWorkspace === null) return null;
    return { phase, seed, workspace: wiring.liveWorkspace };
  }, [wiring]);

  /** The entity that draws `cardId`, re-resolved after a reconcile replaces it. */
  const entityOf = useCallback(
    (cardId: string): Entity | null => {
      const phase = wiring.phase;
      const seed = wiring.seed;
      if (phase.kind !== "ready" || seed === null) return null;
      for (const [entity, slot] of seed.entitySlots) {
        if (slot.cardId !== cardId) continue;
        try {
          if (phase.engine.world.isAlive(entity)) return entity;
        } catch {
          return null;
        }
      }
      return null;
    },
    [wiring],
  );

  /** The card's box and the camera of the frame it lives in, right now. */
  const boxOf = useCallback(
    (cardId: string): IceCardEditorBox | null => {
      if (scene === null) return null;
      const entity = entityOf(cardId);
      if (entity === null) return null;
      const { engine, core } = scene.phase;
      const dom = resolveSurface(refs);
      if (dom === null) return null;
      const camera = engine.world.getResource(core.Camera) as SuiteCardCamera | undefined;
      const geometry = dom.desk.geometryOf(entity) as SuiteCardGeometry | undefined;
      const rect = entityRectOf(engine, core, entity);
      return cardEditorBox({
        geometry: geometry ?? null,
        rect: rect === null ? null : { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        camera,
      });
    },
    [scene, entityOf, refs],
  );

  const boardOf = useCallback(
    (cardId: string): string | null => {
      const seed = wiring.seed;
      if (seed !== null) {
        for (const slot of seed.entitySlots.values()) {
          if (slot.cardId === cardId && slot.boardId.length > 0) return slot.boardId;
        }
      }
      const workspace = wiring.liveWorkspace;
      if (workspace === null) return null;
      return workspace.listCardPlacements(cardId)[0]?.boardId ?? null;
    },
    [wiring],
  );

  /**
   * The one gate: every opening path and the store's own request run it.
   *
   * `measure` is the difference between a *gesture* on a card the reader can see
   * (double click, Enter — the readable-width gate applies) and the shell asking
   * for a card by name (a card it just created, whose title is exactly what was
   * asked for, at whatever zoom the desk happens to be at).
   */
  const gate = useCallback(
    (
      target: IceCardEditorTarget,
      field?: IceCardEditingField,
      measure = true,
    ): IceCardEditorDecision => {
      const workspace = wiring.liveWorkspace;
      if (workspace === null) return { ok: false, reason: "missing-card" };
      const card = workspace.getCard(target.cardId);
      const box = measure ? boxOf(target.cardId) : null;
      return planCardEditor({
        cardId: target.cardId,
        boardId: target.boardId,
        card,
        whiteboard: card !== undefined && isWhiteboardCard(card),
        title: workspace.displayTitle(target.cardId),
        canEditContent: wiring.caps.canEditContent,
        share: getSession().share,
        // No box means "not measurable yet", not "too small": a card the
        // projection has not spawned is still the card the shell asked for.
        ...(box === null ? {} : { screenWidth: box.width }),
        field,
      });
    },
    [wiring, boxOf],
  );

  const open = useCallback(
    (cardId: string, field?: IceCardEditingField): void => {
      const boardId = boardOf(cardId);
      if (boardId === null) return;
      const decision = gate({ cardId, boardId }, field);
      if (!decision.ok) return;
      useUiStore.getState().startEditing(cardId, decision.field, "canvas");
    },
    [boardOf, gate],
  );

  /** One commit window per open editor; it outlives renders so a burst coalesces. */
  const barrier = useMemo(
    () => createTextCommitBarrier({ commit: () => commands.current?.reconcile() }),
    [commands],
  );

  const close = useCallback((): void => {
    // The sheet catches up once, on the way out: the flush is the last commit.
    barrier.flush();
    useUiStore.getState().stopEditing();
  }, [barrier]);

  // The store's own request (a card the shell just created) goes through the same
  // gate: a refusal closes the request rather than mounting an editor that may
  // not write.
  useEffect(() => {
    if (active === null) return;
    const boardId = boardOf(active.cardId);
    const decision =
      boardId === null ? null : gate({ cardId: active.cardId, boardId }, active.field, false);
    if (decision?.ok === true) return;
    useUiStore.getState().stopEditing();
  }, [active, boardOf, gate]);

  // The editor and the whiteboard stage are exclusive: a stage open on another
  // card would leave two DOM editors on the desk.
  useEffect(() => {
    if (active === null) return;
    closeWhiteboard?.();
  }, [active, closeWhiteboard]);

  // A card that left the document (trashed by a peer, purged, undone away) must
  // not keep an editor over the place it used to be.
  useEffect(() => {
    if (active === null) return;
    const card = snapshot.cards.find((entry) => entry.id === active.cardId);
    if (card === undefined || (card.deletedAt ?? null) !== null) close();
  }, [active, snapshot.cards, close]);

  // Entering a Board changes the units the editor is measured in, and the reader
  // has moved on: the session ends with the frame it was opened in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the frame key is the trigger, and closing on a stable one would close every session.
  useEffect(() => {
    if (active === null) return;
    close();
  }, [frameKey]);

  // Selecting something else ends the session: the editor belongs to the card
  // the reader is on, and the store's selection is that fact.
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  useEffect(() => {
    if (active === null) return;
    if (selectedNodeIds.length === 0) return;
    if (selectedNodeIds.includes(active.cardId)) return;
    close();
  }, [active, selectedNodeIds, close]);

  // Gestures: double click a card, and Enter on exactly one selected card.
  useEffect(() => {
    if (scene === null) return;
    const dom = resolveSurface(refs);
    if (dom === null) return;
    const { engine } = scene.phase;
    const world = engine.world;
    const openers: IceCardEditorOpeners = {
      cardAt: (point) => {
        const entity = entityAt(dom.desk, point);
        if (entity === null) return null;
        const identity = identityOf(world, entity);
        if (identity.cardId === null) return null;
        const boardId = identity.boardId ?? boardOf(identity.cardId);
        return boardId === null ? null : { cardId: identity.cardId, boardId };
      },
      selectedCard: () => {
        const selected = useUiStore.getState().selectedNodeIds;
        if (selected.length !== 1) return null;
        const cardId = selected[0] as string;
        const boardId = boardOf(cardId);
        return boardId === null ? null : { cardId, boardId };
      },
      plan: (target, field) => gate(target, field),
      isEditing: () => {
        const ui = useUiStore.getState();
        return ui.editingSurface === "canvas" && ui.editingNodeId !== null;
      },
      editorElement: () => boxRef.current,
      open: (target, field) => {
        useUiStore.getState().startEditing(target.cardId, field, "canvas");
      },
    };
    return attachCardEditorOpeners(
      { root: dom.root, keyTarget: dom.root.ownerDocument.defaultView ?? dom.root },
      openers,
    );
  }, [scene, refs, boardOf, gate]);

  // The frame loop: follow the camera and the card, and write only on a change.
  useEffect(() => {
    if (active === null) return;
    lastBox.current = null;
    let frame = 0;
    const place = (): void => {
      frame = requestAnimationFrame(place);
      const element = boxRef.current;
      const page = pageRef.current;
      if (element === null || page === null) return;
      const box = boxOf(active.cardId);
      if (box === null) {
        // The entity is gone for a tick (a reconcile replacing it), or the card
        // is off screen: keep the editor mounted and hide only its paint.
        element.dataset.placed = "false";
        return;
      }
      element.dataset.placed = "true";
      const previous = lastBox.current;
      if (
        previous !== null &&
        previous.left === box.left &&
        previous.top === box.top &&
        previous.width === box.width &&
        previous.height === box.height &&
        previous.scale === box.scale &&
        previous.angleDeg === box.angleDeg
      ) {
        return;
      }
      lastBox.current = box;
      element.style.left = `${box.left}px`;
      element.style.top = `${box.top}px`;
      element.style.width = `${box.width}px`;
      element.style.height = `${box.height}px`;
      element.style.transform = `rotate(${box.angleDeg}deg)`;
      page.style.transform = `scale(${box.scale})`;
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [active, boxOf]);

  // The desk tearing down is a close: nothing may keep a caret in a surface that
  // no longer exists, and the store must not still name the card.
  useEffect(
    () => () => {
      barrier.cancel();
      const ui = useUiStore.getState();
      if (ui.editingSurface === "canvas" && ui.editingNodeId !== null) ui.stopEditing();
    },
    [barrier],
  );

  // NodeCard's own px layout is the card's world box; the camera only scales it.
  // The document's placement is the truthful size (the geometry carries the
  // paper's lift while a card is held, which is not a size change).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot is the trigger; a placement resized in the document is the new size.
  const size = useMemo(() => {
    if (active === null) return null;
    const placement = wiring.liveWorkspace?.listCardPlacements(active.cardId)[0];
    return {
      width: placement?.width ?? DEFAULT_CARD_WIDTH,
      height: placement?.height ?? DEFAULT_CARD_HEIGHT,
    };
  }, [active, wiring, snapshot.cards]);

  const editor =
    active === null || size === null
      ? null
      : createElement(IceCardEditorOverlay, {
          cardId: active.cardId,
          boardId: boardOf(active.cardId) ?? "",
          field: active.field,
          size,
          boxRef,
          pageRef,
          onEscape: close,
          onFieldChange: (next: IceCardEditingField) => useUiStore.getState().setEditingField(next),
          onClose: close,
          onTextSettled: barrier.touch,
        });

  return useMemo(
    () => ({ editor, open, close, cardId: active?.cardId ?? null }),
    [editor, open, close, active],
  );
}
