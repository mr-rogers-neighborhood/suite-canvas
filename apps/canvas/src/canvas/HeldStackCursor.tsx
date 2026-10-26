import { useReactFlow } from "@xyflow/react";
import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { usePlacementRunStore } from "./placementRun";
import type { PlacementEngine } from "./usePlacementEngine";

/**
 * The stack a held run carries
 * ([ADR-0063](../../../docs/decisions/0063-placement-is-a-mode-too.md) third amendment).
 *
 * A `thread` or a `fan` draws relationships, so the user places each card; the run
 * therefore has to be *visible* in their hand — the next card's title, layered over
 * the ones behind it, with a count. Without it a run is invisible until it dumps
 * five cards, which teaches the user nothing about what happened.
 *
 * A click on the board puts the top of the stack down. The mode decides only what
 * that placement links to, which is the part the user already declared.
 */
export function HeldStackCursor({ engine }: { engine: PlacementEngine }) {
  const run = usePlacementRunStore((state) => state.run);
  const workspace = useCanvasStore((state) => state.workspace);
  const { screenToFlowPosition } = useReactFlow();
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const held = run?.queue[0]?.ids[0] ?? null;
  const waiting = run !== null && run.queue.length === 0;

  useEffect(() => {
    if (!held) {
      setPointer(null);
      return;
    }
    const move = (event: PointerEvent) => {
      setPointer({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [held]);

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
      event.preventDefault();
      event.stopPropagation();
      engine.placeAt(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [engine, held, screenToFlowPosition]);

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
