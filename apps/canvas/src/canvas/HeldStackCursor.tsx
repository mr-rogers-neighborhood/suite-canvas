import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { usePlacementRunStore } from "./placementRun";
import type { PlacementEngine } from "./usePlacementEngine";

/**
 * The stack a held run carries
 * (ADR-0063 third amendment).
 *
 * A `thread` or a `fan` draws relationships, so the user places each card; the run
 * therefore has to be *visible* in their hand — the next card's title, layered over
 * the ones behind it, with a count. Without it a run is invisible until it dumps
 * five cards, which teaches the user nothing about what happened.
 *
 * A click on the board puts the top of the stack down. The mode decides only what
 * that placement links to, which is the part the user already declared.
 */
/**
 * Where a card in hand lands when nothing has moved it yet: the pointer, when the
 * canvas is what is under it, and the middle of the pane otherwise — a run begun in
 * the library leaves the pointer over the drawer, not the board.
 */
function armScreenPoint(last: { x: number; y: number } | null): { x: number; y: number } {
  const rect = document
    .querySelector<HTMLElement>('[data-testid="canvas-board"]')
    ?.getBoundingClientRect();
  const centre = {
    x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
    y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
  };
  if (!last) return centre;
  return document.elementFromPoint(last.x, last.y)?.closest('[data-testid="canvas-board"]')
    ? last
    : centre;
}

export function HeldStackCursor({ engine }: { engine: PlacementEngine }) {
  const run = usePlacementRunStore((state) => state.run);
  const setProposal = usePlacementRunStore((state) => state.setProposal);
  const workspace = useCanvasStore((state) => state.workspace);
  const { screenToFlowPosition } = useReactFlow();
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);

  const held = run?.queue[0]?.ids[0] ?? null;
  const waiting = run !== null && run.queue.length === 0;
  /**
   * The engine is rebuilt on every render of the board, so it cannot be a
   * dependency of the press listener: re-registering during a gesture is how a
   * click between two renders lands on nothing. A ref keeps the handler stable
   * and always calling the current engine.
   */
  const engineRef = useRef(engine);
  engineRef.current = engine;
  /**
   * React Flow's converter is not identity-stable either, so it travels the same
   * way. The press listener then depends on `held` alone: the one thing that
   * decides whether a press places a card at all.
   */
  const toFlow = useRef(screenToFlowPosition);
  toFlow.current = screenToFlowPosition;
  /** Where the cursor last was; seeded once per run so the stack is never invisible. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  /** Whether the run in hand has been put somewhere yet. */
  const armed = useRef(false);

  // Where the pointer is, even with nothing in hand: a run that starts while the
  // cursor is already over the board arms under it rather than at the middle.
  useEffect(() => {
    const track = (event: PointerEvent) => {
      lastPointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", track);
    return () => window.removeEventListener("pointermove", track);
  }, []);

  useEffect(() => {
    if (!held) {
      armed.current = false;
      setPointer(null);
      return;
    }
    // A run arms itself: the card in hand appears the moment the run starts, with
    // its dot already proposed. Waiting for a `pointermove` made a run look like
    // nothing had happened.
    if (!armed.current) {
      armed.current = true;
      const seed = armScreenPoint(lastPointer.current);
      lastPointer.current = seed;
      setPointer(seed);
      setProposal(engineRef.current.proposeAt(toFlow.current(seed)));
    }
    const move = (event: PointerEvent) => {
      lastPointer.current = { x: event.clientX, y: event.clientY };
      setPointer({ x: event.clientX, y: event.clientY });
      // One proposal per frame: the inference is pure but the pointer fires far more
      // often than the canvas paints, and a highlight that lags a frame is invisible.
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        const at = toFlow.current({ x: event.clientX, y: event.clientY });
        setProposal(engineRef.current.proposeAt(at));
      });
    };
    window.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("pointermove", move);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      // Nothing is held, so nothing is proposed: leaving a highlight behind would
      // claim the next drop goes somewhere it does not.
      setProposal(null);
    };
    // `engine` and `toFlow` are deliberately absent: see `engineRef` above.
  }, [held, setProposal]);

  // The click that puts a card down is the canvas's own press, so it is caught in
  // the capture phase before React Flow claims it for panning or selection.
  useEffect(() => {
    if (!held) return;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      // A control keeps its own press: the stack must never swallow a button.
      if (target?.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
      if (!target?.closest('[data-testid="canvas-board"]')) return;
      // A dot is a choice, not a place: pressing one while holding a card names the
      // connector this step should use, and the card stays in hand so the reader can
      // aim it knowing which side it will leave from.
      const dot = target.closest("[data-connector-id]");
      const connectorId = dot?.getAttribute("data-connector-id");
      if (connectorId) {
        event.preventDefault();
        event.stopPropagation();
        usePlacementRunStore.getState().setOverrides({ source: connectorId });
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      engineRef.current.placeAt(toFlow.current({ x: event.clientX, y: event.clientY }));
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
    // `engine` and `toFlow` are deliberately absent: see `engineRef` above.
  }, [held]);

  if (!run) return null;

  // The title lives in the document's text tree, not on the card record.
  const title = held ? workspace.displayTitle(held) || "Untitled" : "Nothing left";
  const left = run.queue.length;

  return (
    <div
      className="held-stack"
      data-testid="held-stack"
      data-waiting={waiting ? "true" : "false"}
      aria-hidden="true"
      style={
        pointer
          ? { left: `${pointer.x}px`, top: `${pointer.y}px` }
          : { left: "-1000px", top: "-1000px" }
      }
    >
      {/* Two underlays are enough to read as a stack; more is a shadow. */}
      <span className="held-stack__under held-stack__under--far" />
      <span className="held-stack__under held-stack__under--near" />
      <span className="held-stack__card">
        <span className="held-stack__title">{title}</span>
        <span className="held-stack__count" data-testid="held-stack-count">
          {`${left} left`}
        </span>
      </span>
    </div>
  );
}
