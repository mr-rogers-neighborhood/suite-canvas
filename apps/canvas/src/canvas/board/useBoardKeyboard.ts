import type { Card } from "@suite/graph";
import { useEffect } from "react";
import { portalTargetId } from "../../cards/portal";
import { useUiStore } from "../../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../interactions/multiSelect";
import { isNudgeKey, nudgeDelta } from "../nudge";
import type { useBoardProjection } from "./useBoardProjection";
import { NEW_SECTION_SIZE } from "./useBoardSections";
import type { useBoardUi } from "./useBoardUi";

type BoardUi = ReturnType<typeof useBoardUi>;
type UiState = ReturnType<typeof useUiStore.getState>;
type FlowPoint = { x: number; y: number };
type Size = { width: number; height: number };

const NEW_CARD_SIZE: Size = { width: DEFAULT_CARD_WIDTH, height: DEFAULT_CARD_HEIGHT };

/** Board helpers a key action may call. */
interface KeyCommands {
  workspace: BoardUi["workspace"];
  store: BoardUi["store"];
  screenToFlowPosition: BoardUi["screenToFlowPosition"];
  activeBoardId: BoardUi["activeBoardId"];
  canCreateContent: boolean;
  canEditContent: boolean;
  canEditLayout: boolean;
  canManageTrash: boolean;
  canManageStructure: boolean;
  goBackBoard: () => void;
  createNoteAt: (position: FlowPoint) => void;
  nudgeSelected: (delta: { dx: number; dy: number }) => void;
  createSectionAt: (position: FlowPoint, wrapSelection?: boolean) => void;
  enterPortal: (nodeId: string, targetBoardId: string) => void;
  trashSelected: () => void;
  unplaceSelected: () => void;
}

/** Everything one key press reads, resolved at press time. */
interface KeyContext {
  event: KeyboardEvent;
  /** The focused element takes text, so a bare key belongs to it. */
  typing: boolean;
  state: UiState;
  commands: KeyCommands;
  cardsById: ReadonlyMap<string, Card>;
  boardCardIds: { current: string[] };
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

/** Centre of a `size` box placed at the middle of the viewport, in flow units. */
function centreOfViewport(commands: KeyCommands, size: Size): FlowPoint {
  const centre = commands.screenToFlowPosition({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  });
  return { x: centre.x - size.width / 2, y: centre.y - size.height / 2 };
}

/**
 * Quick capture: Cmd/Ctrl+Enter adds a card at the viewport centre and opens its
 * title. A text surface keeps the browser's own chord, so the shortcut never
 * steals a key inside an editor body or a field.
 */
function captureCard(ctx: KeyContext): boolean {
  const { event, typing, commands } = ctx;
  if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter" || typing) return false;
  if (event.target instanceof HTMLElement && event.target.closest(".ProseMirror")) return false;
  if (!commands.canCreateContent || !commands.activeBoardId) return false;
  event.preventDefault();
  commands.createNoteAt(centreOfViewport(commands, NEW_CARD_SIZE));
  return true;
}

/**
 * The Escape ladder, most specific layer first. A held run and an armed thread
 * are layers above the board, so they never reach this hook.
 */
function escapeRung(ctx: KeyContext): boolean {
  const { event, state, commands } = ctx;
  if (event.key !== "Escape") return false;

  if (state.editingSectionId) {
    state.setEditingSection(null);
    return true;
  }
  if (state.selectedSectionId) {
    state.selectSection(null);
    state.closeContainerInspector();
    return true;
  }
  if (state.containerInspector) {
    state.closeContainerInspector();
    return true;
  }
  // Focus is a mode of its own: Escape leaves it (and stops its editing) before
  // the card-level or selection-level branches see the key.
  if (state.cardFocusId) {
    state.closeCardFocus();
    return true;
  }
  if (state.editingNodeId) {
    state.stopEditing();
    (document.activeElement as HTMLElement | null)?.blur();
    return true;
  }
  if (state.focusTarget) {
    state.clearFocusTarget();
    return true;
  }
  // A board entered through a portal is a doorway: Escape steps back to the
  // exact board and viewport it was entered from.
  if (state.boardHistory.at(-1)?.via === "portal") {
    commands.goBackBoard();
    return true;
  }
  // Last rung: drop the selection once nothing more specific owns Escape.
  if (
    state.selectedNodeIds.length > 0 ||
    state.selectedEdgeIds.length > 0 ||
    state.selectedConnector
  ) {
    commands.store.getState().unselectNodesAndEdges();
    state.setSelectedNodeIds([]);
    state.setSelectedEdgeIds([]);
    state.setSelectedConnector(null);
    return true;
  }
  return false;
}

/** Cmd/Ctrl chords other than quick capture: undo, new section, select all. */
function modifierChord(ctx: KeyContext): boolean {
  const { event, typing, state, commands } = ctx;
  if (!(event.metaKey || event.ctrlKey) || typing) return false;
  const key = event.key.toLowerCase();

  // Inside a card the editor owns undo (per-fragment history); here it covers
  // structure: moves, links, connectors, place and trash.
  if (key === "z" || key === "y") {
    event.preventDefault();
    if (!commands.canEditContent && !commands.canEditLayout) return true;
    if (key === "z" && !event.shiftKey) commands.workspace.undo();
    else commands.workspace.redo();
    state.setSelectedNodeIds([]);
    state.stopEditing();
    return true;
  }

  if (key === "g" && commands.canCreateContent) {
    event.preventDefault();
    commands.createSectionAt(centreOfViewport(commands, NEW_SECTION_SIZE), true);
    return true;
  }

  // Select every card on the board, never the page text.
  if (key === "a" && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    const ids = ctx.boardCardIds.current;
    const flow = commands.store.getState();
    flow.unselectNodesAndEdges();
    flow.addSelectedNodes(ids);
    state.selectAllOnBoard(ids);
    return true;
  }

  return false;
}

/**
 * Delete and Backspace. Selected links go first: they are edges, not entities,
 * and nothing else is left dangling by removing one.
 */
function removeKey(ctx: KeyContext): boolean {
  const { event, typing, state, commands } = ctx;
  if (event.key !== "Delete" && event.key !== "Backspace") return false;
  if (typing) return true;

  if (state.selectedEdgeIds.length > 0 && commands.canManageStructure) {
    event.preventDefault();
    for (const edgeId of state.selectedEdgeIds) commands.workspace.removeEdge(edgeId);
    state.setSelectedEdgeIds([]);
    return true;
  }
  if (state.selectedSectionId) {
    // Sections are workspace structure: an editor may change them, not delete them.
    if (!commands.canManageStructure) return true;
    event.preventDefault();
    commands.workspace.deleteSection(state.selectedSectionId);
    state.selectSection(null);
    return true;
  }
  if (state.selectedNodeIds.length === 0) return true;
  if (!commands.canManageTrash && !commands.canEditLayout) return true;
  event.preventDefault();
  // Shift is the explicit trash gesture and stays owner-only. A share editor's
  // Delete unplaces, which is the only destructive act it owns.
  if (event.shiftKey && commands.canManageTrash) commands.trashSelected();
  else if (commands.canEditLayout) commands.unplaceSelected();
  return true;
}

/** Enter opens the selected card, or walks through a selected portal. */
function openKey(ctx: KeyContext): boolean {
  const { event, typing, state, commands, cardsById } = ctx;
  if (event.key !== "Enter" || typing || state.editingNodeId) return false;
  const first = state.selectedNodeIds[0];
  if (!first) return false;
  // A selected portal is a doorway even for a viewer: navigating is not an edit.
  const targetBoardId = portalTargetId(cardsById.get(first));
  if (targetBoardId) {
    event.preventDefault();
    commands.enterPortal(first, targetBoardId);
    return true;
  }
  if (!commands.canEditContent) return true;
  event.preventDefault();
  state.startEditing(first, "body");
  return true;
}

/**
 * The board's keys: quick capture, the Escape ladder, curated undo, select-all,
 * delete/unplace and open. The window listener is the only place a key is read,
 * so a surface never has to guess which layer owns it.
 */
export function useBoardKeyboard(
  ui: ReturnType<typeof useBoardUi>,
  input: {
    projection: ReturnType<typeof useBoardProjection>;
    refs: { boardCardIds: { current: string[] } };
    createNoteAt: (position: { x: number; y: number }) => void;
    nudgeSelected: (delta: { dx: number; dy: number }) => void;
    createSectionAt: (position: { x: number; y: number }, wrapSelection?: boolean) => void;
    enterPortal: (nodeId: string, targetBoardId: string) => void;
    trashSelected: () => void;
    unplaceSelected: () => void;
  },
) {
  const {
    workspace,
    activeBoardId,
    store,
    screenToFlowPosition,
    canCreateContent,
    canEditContent,
    canEditLayout,
    canManageTrash,
    canManageStructure,
    goBackBoard,
  } = ui;
  const { projection, refs } = input;
  const { boardCardIds } = refs;
  const { cardsById } = projection;
  const {
    createNoteAt,
    nudgeSelected,
    createSectionAt,
    enterPortal,
    trashSelected,
    unplaceSelected,
  } = input;

  useEffect(() => {
    const commands: KeyCommands = {
      workspace,
      store,
      screenToFlowPosition,
      activeBoardId,
      canCreateContent,
      canEditContent,
      canEditLayout,
      canManageTrash,
      canManageStructure,
      goBackBoard,
      createNoteAt,
      nudgeSelected,
      createSectionAt,
      enterPortal,
      trashSelected,
      unplaceSelected,
    };

    // Order is the contract: capture runs before the Escape ladder, and a chord
    // runs before the bare-key actions that share its key.
    const handleKeyDown = (event: KeyboardEvent) => {
      const ctx: KeyContext = {
        event,
        typing: isTextEntry(event.target),
        state: useUiStore.getState(),
        commands,
        cardsById,
        boardCardIds,
      };
      if (captureCard(ctx)) return;
      if (escapeRung(ctx)) return;
      if (modifierChord(ctx)) return;
      if (removeKey(ctx)) return;
      openKey(ctx);
    };

    /**
     * Arrow keys nudge the selection.
     *
     * Read on the capture phase because React Flow also listens for them on a
     * focused node and moves a card one flow unit per press. Claiming the key
     * before the node sees it keeps one step size, one write per press and no
     * divergence between what is painted and what is stored.
     *
     * This is not a rung of the chain below: it answers only the four arrow
     * keys, so quick capture, the Escape ladder, the chords and the bare-key
     * actions keep the order that comment describes.
     */
    const handleNudgeKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isNudgeKey(event.key)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!commands.canEditLayout || !commands.activeBoardId) return;
      if (isTextEntry(event.target)) return;
      const target = event.target instanceof Element ? event.target : null;
      // Focus after a click on a card sits on the node; after a marquee it can
      // sit on the document. Both mean the board owns the key. A press inside
      // the library, the dock or a dialog does not.
      const onBoard =
        target === null ||
        target === document.body ||
        target === document.documentElement ||
        target.closest('[data-testid="canvas-board"]') !== null;
      if (!onBoard) return;
      // A focused control keeps its own arrow-key meaning (a menu, a slider, a
      // select). The board only nudges when the press is on the board itself.
      if (target?.closest("button, a, input, select, textarea, [role='menu'], [role='dialog']")) {
        return;
      }
      const state = useUiStore.getState();
      if (state.selectedNodeIds.length === 0) return;
      const delta = nudgeDelta(event.key, event.shiftKey);
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      commands.nudgeSelected(delta);
    };

    window.addEventListener("keydown", handleNudgeKeyDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleNudgeKeyDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    workspace,
    store,
    screenToFlowPosition,
    activeBoardId,
    canCreateContent,
    canEditContent,
    canEditLayout,
    canManageTrash,
    canManageStructure,
    goBackBoard,
    createNoteAt,
    nudgeSelected,
    createSectionAt,
    enterPortal,
    trashSelected,
    unplaceSelected,
    cardsById,
    boardCardIds,
  ]);
}
