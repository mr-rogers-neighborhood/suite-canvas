import {
  forceLayout,
  runView,
  type SavedView,
  viewKindOf,
  type WorkspaceDocument,
} from "@suite/graph";
import { useMemo } from "react";
import { BoardMiniature } from "../canvas/BoardMiniature";
import { boardMiniature } from "../canvas/portalMiniature";

export interface ViewFigureProps {
  view: SavedView | undefined;
  workspace: WorkspaceDocument;
  /** Short label under the figure; the card and the embed both show it. */
  caption?: string | undefined;
  className?: string | undefined;
}

/**
 * One saved view, drawn.
 *
 * The three kinds are three answers to the same question, so each draws the result the
 * query already returns rather than a second selection: a lens is a place on a board, a
 * collection is the matching cards laid out as data, and a render is those cards as a
 * graph. Nothing here writes, and nothing recomputes a query differently from the
 * overlay, which is what keeps a view on a card honest about what it selects.
 */
export function ViewFigure({ view, workspace, caption, className }: ViewFigureProps) {
  const kind = view === undefined ? "lens" : viewKindOf(view);

  const result = useMemo(
    () => (view === undefined ? { cardIds: [] } : runView(workspace, view)),
    [workspace, view],
  );

  if (view === undefined) {
    return (
      <div
        data-testid="view-figure-unset"
        className="flex h-full items-center justify-center rounded border border-dashed border-[var(--hairline)] p-3 text-[11px] text-[var(--ink-muted)]"
      >
        No view chosen
      </div>
    );
  }

  return (
    <div
      className={`flex h-full flex-col gap-1 ${className ?? ""}`}
      data-testid={`view-figure-${kind}`}
    >
      <div className="min-h-0 flex-1 overflow-hidden rounded border border-[var(--hairline)]">
        {kind === "lens" ? <LensFigure view={view} workspace={workspace} /> : null}
        {kind === "collection" ? (
          <CollectionFigure
            workspace={workspace}
            cardIds={result.cardIds}
            mode={view.collection?.mode}
          />
        ) : null}
        {kind === "render" ? <RenderFigure workspace={workspace} cardIds={result.cardIds} /> : null}
      </div>
      <p className="shrink-0 truncate text-[10px] text-[var(--ink-muted)]">
        {caption ?? view.name} · {String(result.cardIds.length)}
      </p>
    </div>
  );
}

/** A lens is a place: the board it was saved on, drawn the way a portal draws it. */
function LensFigure({ view, workspace }: { view: SavedView; workspace: WorkspaceDocument }) {
  const boardId = view.lens?.boardId ?? null;
  const board = boardId === null ? undefined : workspace.getBoard(boardId);
  if (board === undefined) {
    return <p className="p-2 text-[11px] text-[var(--ink-muted)]">This lens has no board</p>;
  }
  const sections = workspace.listSections(board.id);
  const placements = workspace.listBoardPlacements(board.id);
  return (
    <BoardMiniature model={boardMiniature(sections, placements)} label={`${board.name} lens`} />
  );
}

/** A collection is data: the matching cards, as a grid or as a table of properties. */
function CollectionFigure({
  workspace,
  cardIds,
  mode = "grid",
}: {
  workspace: WorkspaceDocument;
  cardIds: readonly string[];
  mode?: "database" | "grid" | "list" | undefined;
}) {
  if (cardIds.length === 0) {
    return <p className="p-2 text-[11px] text-[var(--ink-muted)]">Nothing in this collection</p>;
  }

  if (mode === "database") {
    return (
      <table className="w-full border-collapse text-[11px]">
        <tbody>
          {cardIds.slice(0, 12).map((cardId) => (
            <tr key={cardId} className="border-b border-[var(--hairline)] last:border-0">
              <td className="truncate px-1.5 py-0.5">{workspace.displayTitle(cardId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="grid h-full grid-cols-3 gap-1 p-1">
      {cardIds.slice(0, 9).map((cardId) => (
        <div
          key={cardId}
          className="truncate rounded bg-black/5 px-1 py-0.5 text-[10px] dark:bg-white/5"
        >
          {workspace.displayTitle(cardId)}
        </div>
      ))}
    </div>
  );
}

/** A render starts with one layout: the matching cards as a graph of their links. */
function RenderFigure({
  workspace,
  cardIds,
}: {
  workspace: WorkspaceDocument;
  cardIds: readonly string[];
}) {
  const points = useMemo(() => {
    const shown = new Set(cardIds);
    const edges = workspace
      .listEdges()
      .filter((edge) => shown.has(edge.source) && shown.has(edge.target))
      .map((edge) => ({ source: edge.source, target: edge.target }));
    return {
      nodes: forceLayout(
        cardIds.map((id) => ({ id })),
        edges,
      ),
      edges,
    };
  }, [workspace, cardIds]);

  if (cardIds.length === 0) {
    return <p className="p-2 text-[11px] text-[var(--ink-muted)]">Nothing to render</p>;
  }

  const at = new Map(points.nodes.map((point) => [point.id, point]));
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${String(cardIds.length)} cards and their links`}
      className="h-full w-full"
    >
      {points.edges.map((edge) => {
        const from = at.get(edge.source);
        const to = at.get(edge.target);
        if (from === undefined || to === undefined) return null;
        return (
          <line
            key={`${edge.source}-${edge.target}`}
            x1={from.x * 100}
            y1={from.y * 100}
            x2={to.x * 100}
            y2={to.y * 100}
            stroke="var(--hairline)"
            strokeWidth={0.5}
          />
        );
      })}
      {points.nodes.map((point) => (
        <circle key={point.id} cx={point.x * 100} cy={point.y * 100} r={1.6} fill="var(--accent)" />
      ))}
    </svg>
  );
}
