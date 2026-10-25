import type { GraphEdge } from "@suite/graph";
import { useEffect, useState } from "react";
import { isolatedEdgeId, setIsolatedEdge, useIsolatedEdgeId } from "../canvas/routeIsolation";
import { useCanvasStore } from "../store/useCanvasStore";
import { describeDot, type LinkEndView, type LinkInspectorModel } from "./useLinkInspectorModel";

export interface LinkInspectorProps {
  model: LinkInspectorModel;
  onClose: () => void;
  /** Go to the thing at one end, switching boards if it lives elsewhere. */
  onNavigateEnd: (end: LinkEndView) => void;
  /** Arm a one-shot mode: the next connector clicked re-attaches this end. */
  onMoveEnd: (end: "source" | "target") => void;
  /** True while this end is waiting for a dot to be clicked on the canvas. */
  movingEnd: "source" | "target" | null;
  onCancelMoveEnd: () => void;
  onSetPath: (path: GraphEdge["path"]) => void;
  onSetBidirectional: (bidirectional: boolean) => void;
  onReverse: () => void;
  onDelete: () => void;
  onSetDescription: (description: string) => void;
  /** 0..1 along the line; `null` puts the label back at the middle. */
  onSetLabelOffset: (offset: number | null) => void;
}

/** Every value of the stored `path` enum, `avoid` included (ADR-0052 §6). */
const PATHS: Array<{ value: GraphEdge["path"]; label: string }> = [
  { value: "bezier", label: "Curved" },
  { value: "straight", label: "Straight" },
  { value: "step", label: "Step" },
  { value: "smoothstep", label: "Smooth step" },
  { value: "avoid", label: "Avoid obstacles" },
];

/** The document caps a route at 24 bends; the panel matches it. */
const MAX_BENDS = 24;

/**
 * One link, inspected.
 *
 * A link is not an entity — it is an edge — so there is no name, type, tag or
 * body here. The panel repeats what the canvas right-click menu offers (style,
 * direction, delete, description) and adds the three things a line cannot say:
 * which two connectors it joins, a description that can be slid along it, and a
 * way to move one end to another connector without a drag.
 */
export function LinkInspector({
  model,
  onClose,
  onNavigateEnd,
  onMoveEnd,
  movingEnd,
  onCancelMoveEnd,
  onSetPath,
  onSetBidirectional,
  onReverse,
  onDelete,
  onSetDescription,
  onSetLabelOffset,
}: LinkInspectorProps) {
  const { canEdit, canManageStructure } = model;
  const edgeId = model.edge.id;
  const workspace = useCanvasStore((state) => state.workspace);
  const isolating = useIsolatedEdgeId() === edgeId;

  // A route write always carries both halves: the document stores the list and
  // the layer together, so neither can be dropped by editing the other.
  const writeRoute = (bends: LinkInspectorModel["bends"], layer: LinkInspectorModel["layer"]) => {
    workspace.setEdgeRoute(edgeId, { bends, layer });
  };

  /**
   * A new bend at the middle of the line, pushed off it: the same perpendicular
   * a reader would drag it to, so the click has a visible result. Bends are
   * stored relative to the source anchor, which is what makes this stable when
   * the source card moves.
   */
  const addBend = () => {
    if (!canEdit || model.bends.length >= MAX_BENDS) return;
    const source = model.sourceCenter;
    const target = model.targetCenter;
    const dx = (target?.x ?? 0) - (source?.x ?? 0);
    const dy = (target?.y ?? 0) - (source?.y ?? 0);
    const length = Math.hypot(dx, dy) || 1;
    const bow = 48;
    const bend = {
      x: Math.round((dx / 2 - (dy / length) * bow) * 10) / 10,
      y: Math.round((dy / 2 + (dx / length) * bow) * 10) / 10,
    };
    writeRoute([...model.bends, bend], model.layer);
  };

  const removeBend = (index: number) => {
    writeRoute(
      model.bends.filter((_, position) => position !== index),
      model.layer,
    );
  };

  // Leaving this link always gives the board back: isolate is a reading aid for
  // one route, never a mode someone can get stuck in.
  useEffect(() => {
    return () => {
      if (isolatedEdgeId() === edgeId) setIsolatedEdge(null);
    };
  }, [edgeId]);

  const bendHint = (() => {
    if (model.mode === "avoid" && model.bends.length > 0)
      return "Bends win: this link keeps the route you drew until its bends are cleared.";
    if (model.mode === "avoid")
      return "Routing around cards. Adding a bend hands the line back to you.";
    if (model.bends.length > 0)
      return "Every path style follows these bends; drag them on the line.";
    return "Add a bend, or drag the handle on the selected line.";
  })();

  return (
    <aside
      className="card-inspector link-inspector"
      data-testid="link-inspector"
      aria-label="Link info"
    >
      <header className="flex items-start gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[13px] font-semibold text-[var(--ink)]"
            data-testid="link-title"
          >
            {model.source.title} {"\u2192"} {model.target.title}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
            Link{model.bidirectional ? " \u00b7 two-way" : ""}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          data-testid="link-close"
          className="rounded px-1.5 py-0.5 text-[13px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          {"\u00d7"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">
        {/* The two ends: what they are, which dot holds the link, and a way there. */}
        {(["source", "target"] as const).map((end) => {
          const view = model[end];
          const moving = movingEnd === end;
          return (
            <section key={end} className="mb-3" data-testid={`link-end-${end}`}>
              <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
                {end === "source" ? "From" : "To"}
              </h3>
              <div className="mt-1 flex items-start gap-1.5">
                <span aria-hidden="true" className="leading-5 text-[var(--ink-muted)]">
                  {view.glyph}
                </span>
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  title={view.title}
                  data-testid={`link-end-${end}-open`}
                  onClick={() => onNavigateEnd(view)}
                >
                  <span className="block truncate text-[12px] text-[var(--ink)]">{view.title}</span>
                  <span className="block truncate text-[11px] text-[var(--ink-muted)]">
                    {describeDot(view)}
                  </span>
                </button>
                {canEdit ? (
                  <button
                    type="button"
                    className="shrink-0 rounded px-1 text-[10px] leading-5 text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                    data-testid={`link-end-${end}-move`}
                    title="Move this end to another connector"
                    aria-pressed={moving}
                    onClick={() => (moving ? onCancelMoveEnd() : onMoveEnd(end))}
                  >
                    {moving ? "Cancel" : "Move"}
                  </button>
                ) : null}
              </div>
              {moving ? (
                <p
                  className="mt-1 text-[11px] text-[var(--ink-muted)]"
                  data-testid="link-move-hint"
                >
                  Click a connector on the canvas to attach this end there.
                </p>
              ) : null}
            </section>
          );
        })}

        <section className="mt-3">
          <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">Style</h3>
          <div className="mt-1 flex flex-wrap gap-1" data-testid="link-paths">
            {PATHS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className="library-action"
                aria-pressed={model.mode === entry.value}
                disabled={!canEdit}
                data-testid={`link-path-${entry.value}`}
                onClick={() => onSetPath(entry.value)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </section>

        {/* The route itself: the bends a reader drew, and the layer the link
            paints on (ADR-0052 §1, §3, §4). */}
        <section className="mt-3" data-testid="link-route">
          <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">Route</h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button
              type="button"
              className="library-action"
              data-testid="link-add-bend"
              disabled={!canEdit || model.bends.length >= MAX_BENDS}
              onClick={addBend}
            >
              Add bend
            </button>
            <button
              type="button"
              className="library-action"
              data-testid="link-clear-bends"
              disabled={!canEdit || model.bends.length === 0}
              onClick={() => writeRoute([], model.layer)}
            >
              Clear bends
            </button>
          </div>
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]" data-testid="link-bend-hint">
            {bendHint}
          </p>
          <ul className="mt-1" data-testid="link-bends" data-count={model.bends.length}>
            {model.bends.map((bend, index) => (
              <li
                // The point is the identity: two bends are never the same point.
                key={`${bend.x}:${bend.y}`}
                className="flex items-center gap-1 text-[11px] text-[var(--ink)]"
                data-testid={`link-bend-${index}`}
              >
                <span aria-hidden="true" className="text-[var(--ink-muted)]">
                  {"•"}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  Bend {index + 1} · {Math.round(bend.x)}, {Math.round(bend.y)}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-[10px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                  data-testid={`link-bend-remove-${index}`}
                  aria-label={`Remove bend ${index + 1}`}
                  disabled={!canEdit}
                  onClick={() => removeBend(index)}
                >
                  {"×"}
                </button>
              </li>
            ))}
            {model.bends.length === 0 ? (
              <li className="text-[11px] text-[var(--ink-muted)]" data-testid="link-bends-empty">
                No bends yet.
              </li>
            ) : null}
          </ul>

          <h3 className="mt-3 text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
            Layer
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5" data-testid="link-layers">
            {(["below", "above"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className="library-action"
                aria-pressed={model.layer === value}
                disabled={!canEdit}
                data-testid={`link-layer-${value}`}
                onClick={() => writeRoute(model.bends, value)}
              >
                {value === "below" ? "Below cards" : "Above cards"}
              </button>
            ))}
          </div>

          <h3 className="mt-3 text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
            Isolate
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button
              type="button"
              className="library-action"
              aria-pressed={isolating}
              data-testid="link-isolate"
              onClick={() => setIsolatedEdge(isolating ? null : edgeId)}
            >
              {isolating ? "Isolating this link" : "Isolate this link"}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]" data-testid="link-isolate-hint">
            Dims everything but this link, so one route can be read on a busy board.
          </p>
        </section>

        <section className="mt-3">
          <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
            Direction
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <button
              type="button"
              className="library-action"
              aria-pressed={model.bidirectional}
              disabled={!canEdit}
              data-testid="link-bidirectional"
              onClick={() => onSetBidirectional(!model.bidirectional)}
            >
              {model.bidirectional ? "Two-way" : "One-way"}
            </button>
            <button
              type="button"
              className="library-action"
              disabled={!canEdit}
              data-testid="link-reverse"
              onClick={onReverse}
            >
              Reverse
            </button>
          </div>
        </section>

        <section className="mt-3">
          <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
            Description
          </h3>
          <DescriptionField
            value={model.description}
            disabled={!canEdit}
            onCommit={onSetDescription}
          />
          {/* The label's home along the line. The canvas gesture writes the same
              value, so the two can never disagree. */}
          <label className="mt-2 block text-[11px] text-[var(--ink-muted)]" htmlFor="link-offset">
            Position along the line
          </label>
          <div className="mt-0.5 flex items-center gap-1.5">
            <input
              id="link-offset"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={model.labelOffset}
              disabled={!canEdit || model.description.length === 0}
              data-testid="link-offset"
              className="min-w-0 flex-1"
              onChange={(event) => onSetLabelOffset(Number(event.target.value))}
            />
            <button
              type="button"
              className="shrink-0 rounded px-1 text-[10px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              data-testid="link-offset-reset"
              disabled={!canEdit}
              onClick={() => onSetLabelOffset(null)}
            >
              Reset
            </button>
          </div>
        </section>

        <section className="mt-3">
          <button
            type="button"
            className="w-full rounded px-1.5 py-1 text-left text-[12px] text-red-600 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-400"
            data-testid="link-delete"
            disabled={!canManageStructure}
            onClick={onDelete}
          >
            Delete link
          </button>
        </section>
      </div>
    </aside>
  );
}

/**
 * The description, edited in place. A panel is where someone is already reading
 * the link, so sending them to the canvas to type would be a detour; the canvas
 * inline editor stays available for the gesture-first path.
 */
function DescriptionField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // A peer's edit, or a different link, replaces the draft rather than being
  // silently overwritten by whatever this field was holding.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft === value) return;
    onCommit(draft);
  };

  return (
    <div className="mt-1 flex items-center gap-1">
      <input
        className="min-w-0 flex-1 rounded border border-[var(--hairline)] bg-transparent px-1.5 py-1 text-[12px] text-[var(--ink)] disabled:opacity-60"
        data-testid="link-description"
        aria-label="Link description"
        placeholder="Describe this link…"
        value={draft}
        disabled={disabled}
        maxLength={160}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(value);
          }
        }}
      />
    </div>
  );
}
