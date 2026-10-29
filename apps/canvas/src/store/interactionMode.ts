/**
 * What a press on a card means right now.
 *
 * Reading a board and editing it are the same gesture, so the same click either opens the
 * inspector or does not, and a reader who is only panning should not rearrange anything by
 * accident. The control cycles the three, and each one is a whole answer rather than a
 * flag: `inspect` opens the panel beside the caret, `quiet` edits in place and leaves the
 * panel shut, `locked` treats the canvas as a picture to move.
 */
export type InteractionMode = "inspect" | "quiet" | "locked";

/** The order the toggle walks, which is also the order of least surprise. */
export const INTERACTION_MODES: readonly InteractionMode[] = ["inspect", "quiet", "locked"];

/** The state the patch below reads, so it does not need the store's own type. */
export interface ModeState {
  interactionMode: InteractionMode;
  editingSurface: "canvas" | "panel" | "focus";
}

/** The fields any mode change writes, all of them also fields of the UI store. */
export interface ModePatch {
  interactionMode: InteractionMode;
  inspectorNodeId?: null;
  inspectorFieldId?: null;
  editingNodeId?: null;
  editingSurface?: "canvas";
  cardFocusId?: null;
  selectedNodeIds?: string[];
  selectedEdgeIds?: string[];
  selectedConnector?: null;
}

/**
 * The patch that moving to another interaction mode implies.
 *
 * The panel the old mode opened goes away with it, or "clicking no longer opens the
 * inspector" would be a claim about a drawer still on screen. Locked also drops the caret
 * and the selection: a canvas you are only panning must not keep a card armed for the next
 * keystroke.
 */
export function interactionModePatch(
  state: ModeState,
  interactionMode: InteractionMode,
): ModePatch {
  if (interactionMode === "inspect") return { interactionMode };
  const locked = interactionMode === "locked";
  return {
    interactionMode,
    inspectorNodeId: null,
    inspectorFieldId: null,
    ...(state.editingSurface === "panel" || state.editingSurface === "focus"
      ? { editingNodeId: null, editingSurface: "canvas" as const }
      : {}),
    ...(locked
      ? {
          cardFocusId: null,
          editingNodeId: null,
          selectedNodeIds: [],
          selectedEdgeIds: [],
          selectedConnector: null,
        }
      : {}),
  };
}

/** The mode the toggle moves to next. */
export function nextInteractionMode(current: InteractionMode): InteractionMode {
  return (
    INTERACTION_MODES[(INTERACTION_MODES.indexOf(current) + 1) % INTERACTION_MODES.length] ??
    "inspect"
  );
}
