import type { Card } from "@suite/graph";
import { useEffect } from "react";
import { portalTargetId } from "../../cards/portal";
import { redoWithStack, undoWithStack } from "../../history/undoWithStack";
import { useUiStore } from "../../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "../interactions/multiSelect";
import { isNudgeKey, nudgeDelta } from "../nudge";
import { stackInHand, usePlaceStackStore } from "../placeStack";
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
  copySelection: () => void;
  cutSelection: () => void;
  /** Where the paste should land: the pointer, or the middle of the pane. */
  pasteAt: (point: { x: number; y: number }) => void;
  /** Runs a clipboard or delete verb by the id the verb table gives it. */
  runVerb: (id: "delete" | "cut" | "copy" | "paste") => void;
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
 * The Escape ladder, most specific layer first. An armed thread is a layer above the
 * board, so it never reaches this hook; a stack in the reader's hand is not, and is the
 * last rung here.
 */
function escapeRung(ctx: KeyContext): boolean {
  const { event, state, commands } = ctx;
  if (event.key !== "Escape") return false;

  if (state.editingSectionId) {
    state.setEditingSection(null);
    return true;
  }
  if (state.selectedSectionIds.length > 0) {
    // One rung for the set: Escape peels the frames a reader boxed, not one per press.
    state.selectSection(null);
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
  // Nothing selected: drop the selection once nothing more specific owns Escape.
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
  if (resetMode(ctx)) return true;
  // The last rung: a stack in hand is the one thing left to put down. It sits below the
  // mode climb on purpose — a tool is a choice that outlives a gesture, while a hand full
  // of cards is a surface, and the reader who wants it gone presses Escape once more.
  if (stackInHand()) {
    usePlaceStackStore.getState().stop();
    return true;
  }
  return false;
}

/**
 * The two mode axes walk back to their defaults, one per press.
 *
 * Everything above this point *clears* something; a tool is not something to
 * clear, it is a choice that outlives the gesture. So the bottom of the ladder
 * is a climb rather than a dismissal — press Escape with nothing left to close
 * and the next click stops being a thread, then stops being a run, until the
 * canvas is back to plain placing on an exploration. Without this the reader who
 * changed modes an hour ago has no gesture that returns them, and Escape reads as
 * broken the one time it does nothing.
 */
function resetMode(ctx: KeyContext): boolean {
  const { state } = ctx;
  if (state.mode !== "place") {
    state.setMode("place");
    return true;
  }
  if (state.purpose !== "explore") {
    state.setPurpose("explore");
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
    if (key === "z" && !event.shiftKey) undoWithStack(commands.workspace);
    else redoWithStack(commands.workspace);
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
  // Cards come before the section frame they sit in. A box can select both at once, and the
  // cards are what the reader was aiming at: a press on a section already takes the panel and
  // drops the cards, so this order only ever changes a mixed selection, where unlacing cards
  // is the recoverable act and deleting the section that holds them is not.
  if (state.selectedNodeIds.length > 0) {
    if (!commands.canManageTrash && !commands.canEditLayout) return true;
    event.preventDefault();
    // Shift is the explicit trash gesture and stays owner-only. A share editor's
    // Delete unplaces, which is the only destructive act it owns.
    if (event.shiftKey && commands.canManageTrash) commands.trashSelected();
    else if (commands.canEditLayout) commands.unplaceSelected();
    return true;
  }
  if (state.selectedSectionIds.length > 0) {
    // Sections are workspace structure: an editor may change them, not delete them.
    if (!commands.canManageStructure) return true;
    event.preventDefault();
    // Repeated because a nested frame in the set goes with the one holding it; deleting an id that
    // has already gone is a no-op rather than an error.
    for (const sectionId of state.selectedSectionIds) commands.workspace.deleteSection(sectionId);
    state.selectSection(null);
    return true;
  }
  return true;
}

/**
 * Cut, Copy and Paste, on the keys a reader already has in their fingers.
 *
 * The board suppresses the browser's own menu and the document has no clipboard format, so these were
 * missing entirely: Cmd/Ctrl+C on a selected card did nothing at all. A text field keeps its own keys,
 * which is why the handler is behind the same `typing` guard as the rest.
 */
function clipboardKey(ctx: KeyContext): boolean {
  const { event, typing, commands } = ctx;
  if (typing) return false;
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key !== "c" && key !== "x" && key !== "v") return false;
  event.preventDefault();
  if (key === "v") {
    commands.runVerb("paste");
    return true;
  }
  if (!commands.canEditLayout) return true;
  commands.runVerb(key === "x" ? "cut" : "copy");
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
    copySelection: () => void;
    cutSelection: () => void;
    pasteAt: (point: { x: number; y: number }) => void;
    runVerb: (id: "delete" | "cut" | "copy" | "paste") => void;
  },
) {
  const {
    workspace,
    activeBoardId,
    store,
    screenToFlowPosition,
    locked,
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
    copySelection,
    cutSelection,
    pasteAt,
    runVerb,
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
      copySelection,
      cutSelection,
      pasteAt,
      runVerb,
    };

    // Order is the contract: capture runs before the Escape ladder, and a chord
    // runs before the bare-key actions that share its key.
    const handleKeyDown = (event: KeyboardEvent) => {
      // A locked canvas answers nothing but the browser's own keys: no nudging the
      // selection, no Delete, no new card. Escape still has to work, or a reader who
      // locked the canvas during a peek could not dismiss it.
      if (locked && event.key !== "Escape") return;
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
      if (clipboardKey(ctx)) return;
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
      // A frame on its own is still something the arrows move; a board with nothing selected is not.
      if (state.selectedNodeIds.length === 0 && state.selectedSectionIds.length === 0) return;
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
    locked,
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
    copySelection,
    cutSelection,
    pasteAt,
    runVerb,
    cardsById,
    boardCardIds,
  ]);
}
