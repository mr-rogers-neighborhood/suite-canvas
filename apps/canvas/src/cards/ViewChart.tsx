import type { SavedView, ViewContext, WorkspaceDocument } from "@suite/graph";
import { resolveContext, sectionForCard } from "@suite/graph";
import type React from "react";
import { useMemo } from "react";
import { type ChartSeries, chartSeries, numericValue } from "./viewChart";

export interface ViewChartProps {
  view: SavedView;
  workspace: WorkspaceDocument;
  context?: ViewContext;
  className?: string | undefined;
  /**
   * What a bar, a point or a legend row means when it is pressed.
   *
   * A chart is the most direct way to ask a question of a view — "what is in *that* bar?" — so a bucket is
   * pressable and the layer narrows *this reader's* surface to it. It is not a query write: looking at a
   * bar must not change what everyone else sees.
   */
  onSelectBucket?: ((label: string) => void) | undefined;
  /** The bucket this reader has narrowed to, drawn as the chosen one. */
  selected?: string | null | undefined;
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

const BAR_HEIGHT = 16;
const GAP = 7;
const LABEL_WIDTH = 96;
const VALUE_WIDTH = 38;
const PAD = 8;

/**
 * A bar or line chart of a view's result.
 *
 * SVG with a fixed row height and a real axis: the labels are the hard part, and scaling the drawing to the
 * frame would make a one-card view a single full-width bar that says nothing. The value is printed beside
 * every bar, because a chart in a 200px card is a reading aid, not a dashboard.
 */
export function ViewChart({
  view,
  workspace,
  context = {},
  className,
  onSelectBucket,
  selected = null,
}: ViewChartProps) {
  const series = useViewChart(view, workspace, context);

  if (series.empty) {
    return (
      <p className="p-2 text-[11px] text-[var(--ink-muted)]" data-testid="view-chart-empty">
        Nothing to chart yet.
      </p>
    );
  }

  const pick = onSelectBucket;
  const bucketProps = (label: string) =>
    pick === undefined
      ? {}
      : {
          role: "button" as const,
          tabIndex: 0,
          "aria-pressed": selected === label,
          onClick: () => pick(label),
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            pick(label);
          },
        };

  if (view.render?.layout === "line") {
    const width = 320;
    const height = Math.max(96, series.buckets.length * 22 + 28);
    const plotWidth = width - PAD * 2;
    const plotHeight = height - PAD * 2 - 14;
    const step = series.buckets.length <= 1 ? 0 : plotWidth / (series.buckets.length - 1);
    const scale = (value: number) =>
      series.max === 0 ? plotHeight : plotHeight - (value / series.max) * plotHeight;
    const points = series.buckets.map((bucket, index) => ({
      bucket,
      x: PAD + index * step,
      y: PAD + scale(bucket.value),
    }));
    const path = points
      .map((point, index) => `${index === 0 ? "M" : "L"}${String(point.x)},${String(point.y)}`)
      .join(" ");

    return (
      <div className={className} data-testid="view-chart-line">
        <svg
          role="img"
          aria-label={`${view.name}, ${String(series.buckets.length)} points`}
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          className="h-full w-full"
          preserveAspectRatio="xMinYMin meet"
        >
          {/* The baseline and the ceiling: without them a rising line says nothing about its own scale. */}
          <line
            x1={PAD}
            x2={width - PAD}
            y1={PAD + plotHeight}
            y2={PAD + plotHeight}
            className="stroke-[var(--hairline)]"
            strokeWidth={1}
          />
          <line
            x1={PAD}
            x2={width - PAD}
            y1={PAD}
            y2={PAD}
            className="stroke-[var(--hairline)]"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          <text x={PAD} y={PAD - 1} className="fill-[var(--ink-muted)]" style={{ fontSize: 8 }}>
            {format(series.max)}
          </text>
          <path
            d={path}
            fill="none"
            className="stroke-[var(--accent)]"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          {points.map((point) => (
            <g key={point.bucket.label}>
              <circle
                cx={point.x}
                cy={point.y}
                r={selected === point.bucket.label ? 4 : 2.5}
                className={
                  selected === null || selected === point.bucket.label
                    ? "fill-[var(--accent)]"
                    : "fill-[var(--ink-muted)]"
                }
              />
              <text
                x={point.x}
                y={height - 8}
                textAnchor="middle"
                className="fill-[var(--ink-muted)]"
                style={{ fontSize: 8 }}
              >
                {truncate(point.bucket.label, 9)}
              </text>
              <rect
                x={point.x - Math.max(6, step / 2)}
                y={PAD}
                width={Math.max(12, step)}
                height={plotHeight}
                fill="transparent"
                {...bucketProps(point.bucket.label)}
              >
                <title>{`${point.bucket.label}: ${format(point.bucket.value)}`}</title>
              </rect>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  const width = 320;
  const chartWidth = width - LABEL_WIDTH - VALUE_WIDTH - PAD * 2;
  const height = series.buckets.length * (BAR_HEIGHT + GAP) + GAP;

  return (
    <div className={className} data-testid="view-chart-bar">
      <svg
        role="img"
        aria-label={`${view.name}, ${String(series.buckets.length)} groups`}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        className="h-full w-full"
        preserveAspectRatio="xMinYMin meet"
      >
        {series.buckets.map((bucket, index) => {
          const y = GAP + index * (BAR_HEIGHT + GAP);
          const barWidth =
            series.max === 0 ? 0 : Math.max(2, (bucket.value / series.max) * chartWidth);
          const dim = selected !== null && selected !== bucket.label;
          return (
            <g
              key={bucket.label}
              opacity={dim ? 0.4 : 1}
              {...bucketProps(bucket.label)}
              style={pick === undefined ? undefined : { cursor: "pointer" }}
            >
              <title>{`${bucket.label}: ${format(bucket.value)}`}</title>
              <text
                x={0}
                y={y + BAR_HEIGHT - 4}
                className="fill-[var(--ink-muted)]"
                style={{ fontSize: 9 }}
              >
                {truncate(bucket.label, 15)}
              </text>
              <rect
                x={LABEL_WIDTH}
                y={y}
                width={chartWidth}
                height={BAR_HEIGHT}
                rx={2}
                className="fill-[var(--hairline)]"
                opacity={0.4}
              />
              <rect
                x={LABEL_WIDTH}
                y={y}
                width={barWidth}
                height={BAR_HEIGHT}
                rx={2}
                className="fill-[var(--accent)]"
              />
              <text
                x={LABEL_WIDTH + chartWidth + 4}
                y={y + BAR_HEIGHT - 4}
                className="fill-[var(--ink)]"
                style={{ fontSize: 9 }}
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
