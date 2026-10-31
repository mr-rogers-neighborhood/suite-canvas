import type { SavedView, ViewQuery, WorkspaceDocument } from "@suite/graph";
import { viewKindOf } from "@suite/graph";
import { Chip, Segmented } from "./chip";

/** The presentations a collection offers, as one control rather than one chip per mode. */
const COLLECTION_MODES = [
  { value: "database", label: "Table", title: "A table of rows and fields" },
  { value: "grid", label: "Grid", title: "A grid of tiles" },
  { value: "list", label: "List", title: "A list of rows" },
  { value: "board", label: "Board", title: "The cards where they sit on their board" },
] as const;

const RENDER_LAYOUTS = [
  { value: "graph-2d", label: "Graph", title: "The selected cards and their links" },
  { value: "bar", label: "Bars", title: "An aggregate, as bars" },
  { value: "line", label: "Line", title: "An aggregate, as a line" },
] as const;

const GROUPINGS = [
  { value: "none", label: "No grouping" },
  { value: "section", label: "Section" },
  { value: "type", label: "Type" },
  { value: "tag", label: "Tag" },
] as const;

export interface SurfaceControlsProps {
  view: SavedView;
  workspace: WorkspaceDocument;
  onCollection: (collection: NonNullable<SavedView["collection"]>) => void;
  onRender: (render: NonNullable<SavedView["render"]>) => void;
  onQuery: (patch: Partial<ViewQuery>) => void;
}

/**
 * How the presentation is drawn, and how its result is bucketed.
 *
 * Two questions, two rows: the first is the view's *kind* payload (a collection's mode, a render's layout),
 * the second is the query, which is why changing a grouping is a document write and changing a mode is a
 * different key of the same record.
 */
export function SurfaceControls({
  view,
  workspace,
  onCollection,
  onRender,
  onQuery,
}: SurfaceControlsProps) {
  const kind = viewKindOf(view);
  const collection = view.collection ?? { mode: "database" as const };
  const render = view.render ?? { layout: "graph-2d" as const, measure: { of: "count" as const } };
  const chart = kind === "render" && render.layout !== "graph-2d";

  const groupable = groupableFields(workspace, view);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="views-surface-controls">
      {kind === "collection" ? (
        <Segmented
          label="Presentation"
          testIdPrefix="views-mode"
          value={collection.mode}
          options={COLLECTION_MODES}
          onChange={(mode) => onCollection({ ...collection, mode })}
        />
      ) : (
        <Segmented
          label="Layout"
          testIdPrefix="views-layout"
          value={render.layout}
          options={RENDER_LAYOUTS}
          onChange={(layout) => onRender({ ...render, layout })}
        />
      )}

      {chart ? null : (
        <>
          <span aria-hidden="true" className="h-3 w-px bg-[var(--hairline)]" />
          <GroupingControl view={view} fields={groupable} onQuery={onQuery} />
        </>
      )}

      {chart ? (
        <>
          <span aria-hidden="true" className="h-3 w-px bg-[var(--hairline)]" />
          {(["count", "sum", "average"] as const).map((of) => (
            <Chip
              key={of}
              pressed={render.measure?.of === of}
              count={undefined}
              onClick={() =>
                onRender({
                  ...render,
                  // A sum needs a field; without one the count is the only honest measure, so the measure
                  // keeps its field until a field is chosen.
                  measure:
                    of === "count"
                      ? { of: "count" }
                      : {
                          of,
                          fieldId:
                            (render.measure?.of === "count"
                              ? undefined
                              : render.measure?.fieldId) ?? "",
                        },
                })
              }
            >
              {of === "count" ? "Count" : of === "sum" ? "Sum" : "Average"}
            </Chip>
          ))}
          <span aria-hidden="true" className="h-3 w-px bg-[var(--hairline)]" />
          {([undefined, "type", "tag", "section"] as const).map((groupBy) => (
            <Chip
              key={groupBy ?? "none"}
              pressed={render.groupBy === groupBy}
              onClick={() => onRender({ ...render, groupBy })}
            >
              {groupBy === undefined ? "One bar" : `by ${groupBy}`}
            </Chip>
          ))}
        </>
      ) : null}
    </div>
  );
}

function GroupingControl({
  view,
  fields,
  onQuery,
}: {
  view: SavedView;
  fields: readonly { id: string; name: string }[];
  onQuery: (patch: Partial<ViewQuery>) => void;
}) {
  const current = view.query.groupBy;
  const named = typeof current === "object" ? current.field : undefined;
  return (
    <span className="flex items-center gap-1" data-testid="views-grouping">
      <span className="views-tertiary">Group by</span>
      {GROUPINGS.map((option) => (
        <Chip
          key={option.value}
          pressed={
            option.value === "none"
              ? current === undefined && !view.query.groupBySection
              : current === option.value
          }
          onClick={() =>
            onQuery({
              groupBy: option.value === "none" ? undefined : option.value,
              // The legacy boolean is what older documents read; keeping it in step means one answer.
              groupBySection: option.value === "section",
            })
          }
        >
          {option.label}
        </Chip>
      ))}
      {fields.length === 0 ? null : (
        <select
          className="views-input w-auto py-0.5 text-[11px]"
          aria-label="Group by a field"
          data-testid="views-grouping-field"
          value={named ?? ""}
          onChange={(event) =>
            onQuery(
              event.target.value === ""
                ? { groupBy: undefined, groupBySection: false }
                : { groupBy: { field: event.target.value }, groupBySection: false },
            )
          }
        >
          <option value="">A field…</option>
          {fields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}

/** The fields a grouping could use: the ones whose stored value is already a label. */
function groupableFields(
  workspace: WorkspaceDocument,
  view: SavedView,
): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const type of workspace.listTypes()) {
    for (const field of type.fields) {
      if (field.kind === "group" || field.kind === "list" || field.kind === "media") continue;
      if (!seen.has(field.id)) seen.set(field.id, field.name);
    }
  }
  const chosen = view.query.groupBy;
  if (typeof chosen === "object" && !seen.has(chosen.field)) seen.set(chosen.field, "Field");
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}
