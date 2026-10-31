import { embedStubLabel, resolveEmbed } from "@suite/graph";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useCallback, useRef } from "react";
import { StaticCardBody, StaticCardTitle } from "../cards/StaticCardFace";
import { useCanvasStore } from "../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { EMBED_DEFAULT_SIZE, EMBED_MAX_SIZE, EMBED_MIN_SIZE, EMBED_NODE_NAME } from "./embedNode";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * One embedded card.
 *
 * Resolution is a pure question asked of `resolveEmbed`, so the cycle rule and the depth
 * budget are decided before anything renders: this view never has to defend itself while
 * drawing. The figure itself is the card's own read-only face, which is what makes an
 * embed show what the card shows rather than a second design of it.
 *
 * The size is document data: dragging the corner writes `width`/`height` on the node, so
 * it persists, syncs and undoes like any other edit. Nothing recomputes the host card,
 * which is the deliberate v1: an embed that grows does not push its neighbours around.
 */
export function EmbedView({ node, selected, updateAttributes }: NodeViewProps) {
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const drag = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  const cardId = typeof node.attrs.cardId === "string" ? node.attrs.cardId : "";
  const width = clamp(
    typeof node.attrs.width === "number" ? node.attrs.width : EMBED_DEFAULT_SIZE.width,
    EMBED_MIN_SIZE.width,
    EMBED_MAX_SIZE.width,
  );
  const height = clamp(
    typeof node.attrs.height === "number" ? node.attrs.height : EMBED_DEFAULT_SIZE.height,
    EMBED_MIN_SIZE.height,
    EMBED_MAX_SIZE.height,
  );

  const resolution = resolveEmbed(
    cardId,
    { depth: 1, ancestors: [] },
    {
      cardExists: (id) => snapshot.cards.some((card) => card.id === id),
    },
  );

  const onResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      drag.current = { x: event.clientX, y: event.clientY, width, height };
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
    },
    [width, height],
  );

  const onResizeMove = useCallback(
    (event: React.PointerEvent) => {
      const start = drag.current;
      if (start === null) return;
      event.stopPropagation();
      updateAttributes({
        width: clamp(
          start.width + (event.clientX - start.x),
          EMBED_MIN_SIZE.width,
          EMBED_MAX_SIZE.width,
        ),
        height: clamp(
          start.height + (event.clientY - start.y),
          EMBED_MIN_SIZE.height,
          EMBED_MAX_SIZE.height,
        ),
      });
    },
    [updateAttributes],
  );

  const onResizeEnd = useCallback((event: React.PointerEvent) => {
    drag.current = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }, []);

  if (resolution.kind === "stub" && resolution.reason === "unset") {
    // The one stub the reader can act on: an embed with no card is a question, not a
    // failure, so it asks it in place rather than sending them somewhere else.
    const choices = [...snapshot.cards]
      .map((card) => ({ id: card.id, title: workspace.displayTitle(card.id) }))
      .sort((left, right) => left.title.localeCompare(right.title));
    return (
      <NodeViewWrapper
        className="embed-node my-2 rounded-lg border border-dashed border-[var(--hairline)] px-3 py-2"
        data-embed-state="unset"
        contentEditable={false}
      >
        <label className="flex items-center gap-2 text-[11px] text-[var(--ink-muted)]">
          Embed a card
          <select
            data-testid="embed-choose"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value.length > 0) updateAttributes({ cardId: event.target.value });
            }}
            className="min-w-0 flex-1 rounded border border-[var(--hairline)] bg-[var(--surface)] px-1.5 py-0.5 text-[11px] text-[var(--ink)]"
          >
            <option value="">Choose a card…</option>
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.title}
              </option>
            ))}
          </select>
        </label>
      </NodeViewWrapper>
    );
  }

  if (resolution.kind === "stub") {
    return (
      <NodeViewWrapper
        className={`embed-node my-2 rounded-lg border border-dashed px-3 py-2 text-[11px] text-[var(--ink-muted)] ${
          selected ? "border-[var(--brand)]" : "border-[var(--hairline)]"
        }`}
        data-embed-state={resolution.reason}
        contentEditable={false}
      >
        <span className="font-medium">Embed</span>
        <span className="ml-1.5">{embedStubLabel(resolution.reason)}</span>
      </NodeViewWrapper>
    );
  }

  const contentId = workspace.peekContent(resolution.cardId)?.id ?? null;
  const titleId = workspace.peekTitle(resolution.cardId)?.id ?? null;

  return (
    <NodeViewWrapper
      className={`embed-node relative my-2 overflow-hidden rounded-lg border bg-[var(--surface)] ${
        selected ? "border-[var(--brand)]" : "border-[var(--hairline)]"
      }`}
      data-embed-state="card"
      data-embed-card={resolution.cardId}
      contentEditable={false}
      style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
    >
      <div className="flex h-full flex-col overflow-auto p-2">
        <div className="mb-1 shrink-0 text-[13px] font-semibold">
          <StaticCardTitle cardDoc={workspace.doc} titleId={titleId} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto text-sm">
          <StaticCardBody cardDoc={workspace.doc} contentId={contentId} canEdit={false} />
        </div>
      </div>
      {/* The grip is the WYSIWYG half: the size is written to the node as it moves, so
          what the reader sees is what every other reader gets. */}
      <button
        type="button"
        aria-label="Resize embed"
        data-testid="embed-resize"
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize rounded-tl border-t border-l border-[var(--hairline)] bg-[var(--surface)]"
        style={{ touchAction: "none" }}
      />
    </NodeViewWrapper>
  );
}

/** The node name, re-exported so callers need one import for the pair. */
export { EMBED_NODE_NAME };
