import type { SavedView, ViewContext, WorkspaceDocument } from "@suite/graph";
import { resolveContext, sectionForCard } from "@suite/graph";
import { useMemo } from "react";
import { type ChartSeries, chartSeries, numericValue } from "./viewChart";

export interface ViewChartProps {
  view: SavedView;
  workspace: WorkspaceDocument;
  context?: ViewContext;
  className?: string | undefined;
}

/**
 * The rows a chart is drawn from: one per card in the view's context.
 *
 * Grouping reads what the document already knows: the card's type, its tags, the section it sits in
 * on the active board, or one field's value. A chart therefore never invents a second vocabulary, and
 * a card carrying two tags lands in two buckets, which is what a tag means everywhere else here.
 */
export function chartRows(workspace: WorkspaceDocument, view: SavedView, context: ViewContext) {
  const result = resolveContext(workspace, view, context);
  const measure = view.render?.measure ?? { of: "count" as const };
  const groupBy = view.render?.groupBy;

  const typeNames = new Map(workspace.listTypes().map((type) => [type.id, type.name]));
  const tagNames = new Map(workspace.listTags().map((tag) => [tag.id, tag.name]));
  const sections = workspace.listSections(context.boardId ?? undefined);
  const placements = new Map(
    workspace.listPlacements().map((placement) => [placement.cardId, placement]),
  );

  return result.cardIds.map((cardId) => {
    const card = workspace.getCard(cardId);
    const placement = placements.get(cardId);
    const buckets: string[] = [];
    if (groupBy === undefined) {
      buckets.push("All cards");
    } else if (groupBy === "type") {
      buckets.push(
        card === undefined ? "No type" : (typeNames.get(card.primaryTypeId) ?? "No type"),
      );
    } else if (groupBy === "tag") {
      for (const tagId of card?.tags ?? []) buckets.push(tagNames.get(tagId) ?? "Untagged");
    } else if (groupBy === "section") {
      // The same geometric rule the query engine uses: a card's section is the one its anchor sits
      // in, on the board it is placed on. A card in the inbox belongs to none.
      const section =
        placement === undefined
          ? undefined
          : sectionForCard(
              placement,
              sections.filter((entry) => entry.boardId === placement.boardId),
            );
      buckets.push(section?.title.trim() || "No section");
    } else {
      const raw = card?.properties[groupBy.field];
      buckets.push(raw === undefined || raw === null ? "No value" : String(raw));
    }

    const value =
      measure.of === "count" ? 1 : (numericValue(card?.properties[measure.fieldId]) ?? 0);

    return { id: cardId, buckets, value };
  });
}

/** The series a view's render draws, recomputed only when the view or the document moves. */
export function useViewChart(
  view: SavedView,
  workspace: WorkspaceDocument,
  context: ViewContext = {},
): ChartSeries {
  const average = view.render?.measure?.of === "average";
  const line = view.render?.layout === "line";
  const boardId = context.boardId ?? null;
  const rows = useMemo(
    () => chartRows(workspace, view, { boardId }),
    // `workspace` reads the document itself; the view and the board are the inputs.
    [workspace, view, boardId],
  );
  return useMemo(() => chartSeries(rows, { average, preserveOrder: line }), [rows, average, line]);
}

const BAR_HEIGHT = 14;
const GAP = 6;
const LABEL_WIDTH = 92;

/**
 * A bar or line chart of a view's result.
 *
 * SVG with a fixed row height, because the labels are the hard part and a scaled axis would make a
 * one-card view a single full-width bar that says nothing. The value is printed beside every bar: a
 * chart in a 200px card is a reading aid, not a dashboard.
 */
export function ViewChart({ view, workspace, context = {}, className }: ViewChartProps) {
  const series = useViewChart(view, workspace, context);

  if (series.empty) {
    return (
      <p className="p-2 text-[11px] text-[var(--ink-muted)]" data-testid="view-chart-empty">
        Nothing to chart yet.
      </p>
    );
  }

  if (view.render?.layout === "line") {
    return (
      <div className={className} data-testid="view-chart-line">
        <ol className="flex flex-col gap-0.5 p-2 text-[11px]">
          {series.buckets.map((bucket) => (
            <li key={bucket.label} className="flex items-center gap-1">
              <span className="w-[92px] shrink-0 truncate text-[var(--ink-muted)]">
                {bucket.label}
              </span>
              <span className="tabular-nums">{format(bucket.value)}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const width = Math.max(160, series.buckets.length * 0 + 240);
  const chartWidth = width - LABEL_WIDTH - 40;
  const height = series.buckets.length * (BAR_HEIGHT + GAP) + GAP;

  return (
    <div className={className} data-testid="view-chart-bar">
      <svg
        role="img"
        aria-label={`${view.name}, ${series.buckets.length} groups`}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        className="h-full w-full"
        preserveAspectRatio="xMinYMin meet"
      >
        {series.buckets.map((bucket, index) => {
          const y = GAP + index * (BAR_HEIGHT + GAP);
          const barWidth =
            series.max === 0 ? 0 : Math.max(2, (bucket.value / series.max) * chartWidth);
          return (
            <g key={bucket.label}>
              <text
                x={0}
                y={y + BAR_HEIGHT - 3}
                className="fill-[var(--ink-muted)]"
                style={{ fontSize: 10 }}
              >
                {truncate(bucket.label, 14)}
              </text>
              <rect
                x={LABEL_WIDTH}
                y={y}
                width={barWidth}
                height={BAR_HEIGHT}
                rx={2}
                className="fill-[var(--accent)]"
              />
              <text
                x={LABEL_WIDTH + barWidth + 4}
                y={y + BAR_HEIGHT - 3}
                className="fill-[var(--ink)]"
                style={{ fontSize: 10 }}
              >
                {format(bucket.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function truncate(label: string, limit: number): string {
  return label.length <= limit ? label : `${label.slice(0, limit - 1)}…`;
}
