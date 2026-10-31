import type { ViewPredicateGroup, ViewSort } from "@suite/graph";
import { useMemo } from "react";
import type { ViewDraft } from "../views/draft";

export interface ViewQueryAdvancedProps {
  draft: ViewDraft;
  /** Card types, tags and sections the facet rows offer. */
  types: readonly { id: string; name: string }[];
  tags: readonly { id: string; name: string }[];
  sections: readonly { id: string; title: string }[];
  onChange: (patch: Partial<ViewDraft["query"]>) => void;
}

const fieldClass =
  "rounded-md border border-[var(--hairline)] bg-transparent px-1.5 py-0.5 text-[11px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]";

const rowClass =
  "flex flex-wrap items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]";

const smallButton =
  "rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10";

/**
 * The part of a query the context step does not show: sorts and predicate groups.
 *
 * It is a view over the schema that already exists, not a second query language — `sorts` and
 * `groups` are what `runViewQuery` reads. Predicate rows cover the facets the editor can lay out
 * honestly (type, tag, section and text); `property`, `presence` and `relation` are evaluated by the
 * engine and named here as not yet editable, which is a gap a reader can see rather than guess at.
 */
export function ViewQueryAdvanced({
  draft,
  types,
  tags,
  sections,
  onChange,
}: ViewQueryAdvancedProps) {
  const { sorts = [], groups = [] } = draft.query;
  const unsupported = groups.filter((group) =>
    [...(group.any ?? []), ...(group.not ?? [])].some(
      (predicate) => !["type", "tag", "section", "text"].includes(predicate.p),
    ),
  ).length;

  const setSorts = (next: ViewSort[]) => onChange({ sorts: next.length === 0 ? undefined : next });

  const setGroups = (next: ViewPredicateGroup[]) =>
    onChange({ groups: next.length === 0 ? undefined : next });

  const facets = useMemo(
    () =>
      groups.map((group) => ({
        any: (group.any ?? []).filter((predicate) =>
          ["type", "tag", "section", "text"].includes(predicate.p),
        ),
        not: (group.not ?? []).filter((predicate) =>
          ["type", "tag", "section", "text"].includes(predicate.p),
        ),
      })),
    [groups],
  );

  return (
    <div className="flex flex-col gap-2" data-testid="views-advanced">
      <section className="flex flex-col gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Sorts
        </h3>
        {sorts.length === 0 ? (
          <p className="text-[11px] text-[var(--ink-muted)]">
            The view's order decides: title, updated, or the search's relevance.
          </p>
        ) : null}
        {sorts.map((sort, index) => (
          <div key={`${sort.by}-${String(index)}`} className={rowClass}>
            <select
              aria-label={`Sort ${String(index + 1)} by`}
              className={fieldClass}
              value={sort.by}
              onChange={(event) =>
                setSorts(
                  sorts.map((entry, at) =>
                    at === index ? { ...entry, by: event.target.value as ViewSort["by"] } : entry,
                  ),
                )
              }
            >
              <option value="title">Title</option>
              <option value="updated">Updated</option>
              <option value="created">Created</option>
              <option value="section">Section</option>
            </select>
            <select
              aria-label={`Sort ${String(index + 1)} direction`}
              className={fieldClass}
              value={sort.dir}
              onChange={(event) =>
                setSorts(
                  sorts.map((entry, at) =>
                    at === index ? { ...entry, dir: event.target.value as ViewSort["dir"] } : entry,
                  ),
                )
              }
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <button
              type="button"
              className={smallButton}
              aria-label={`Remove sort ${String(index + 1)}`}
              onClick={() => setSorts(sorts.filter((_, at) => at !== index))}
            >
              {"\u00d7"}
            </button>
          </div>
        ))}
        <button
          type="button"
          className={`${smallButton} w-fit`}
          onClick={() => setSorts([...sorts, { by: "title", dir: "asc" }])}
        >
          Add a sort
        </button>
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Rules
        </h3>
        <p className="text-[11px] text-[var(--ink-muted)]">
          Every rule must pass. Inside one, <em>any of</em> is a choice and <em>not</em> is a veto.
        </p>
        {facets.map((facet, groupIndex) => (
          <div
            key={String(groupIndex)}
            className="rounded-lg border border-[var(--hairline)] p-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium">Rule {groupIndex + 1}</span>
              <button
                type="button"
                className={smallButton}
                aria-label={`Remove rule ${String(groupIndex + 1)}`}
                onClick={() => setGroups(groups.filter((_, at) => at !== groupIndex))}
              >
                Remove
              </button>
            </div>
            {(["any", "not"] as const).map((bucket) => (
              <div key={bucket} className="mt-1 flex flex-wrap items-center gap-1">
                <span className="w-8 text-[10px] uppercase text-[var(--ink-muted)]">{bucket}</span>
                {(facet[bucket] ?? []).map((predicate, at) => (
                  <span
                    key={`${bucket}-${String(at)}`}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--segmented-bg)] px-1.5 text-[10px]"
                  >
                    {describe(predicate, { types, tags, sections })}
                    <button
                      type="button"
                      aria-label={`Remove ${describe(predicate, { types, tags, sections })}`}
                      className="opacity-60 hover:opacity-100"
                      onClick={() =>
                        setGroups(
                          groups.map((group, indexAt) =>
                            indexAt === groupIndex
                              ? {
                                  ...group,
                                  [bucket]: (group[bucket] ?? []).filter((_, i) => i !== at),
                                }
                              : group,
                          ),
                        )
                      }
                    >
                      {"\u00d7"}
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className={smallButton}
                  onClick={() =>
                    setGroups(
                      groups.map((group, indexAt) =>
                        indexAt === groupIndex
                          ? {
                              ...group,
                              [bucket]: [
                                ...(group[bucket] ?? []),
                                { p: "text" as const, terms: "…" },
                              ],
                            }
                          : group,
                      ),
                    )
                  }
                >
                  + text
                </button>
              </div>
            ))}
          </div>
        ))}
        <button
          type="button"
          className={`${smallButton} w-fit`}
          onClick={() => setGroups([...groups, { any: [] }])}
        >
          Add a rule
        </button>
        {unsupported > 0 ? (
          <p className="text-[10px] text-[var(--ink-muted)]" data-testid="views-advanced-note">
            {unsupported} rule {unsupported === 1 ? "uses" : "rules use"} a predicate this editor
            cannot draw yet (property, presence or relation). The view keeps it; the summary above
            counts what it can show.
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** A predicate in words, so a chip reads as the rule it is. */
function describe(
  predicate: { p: string; ids?: string[]; terms?: string },
  lookup: {
    types: readonly { id: string; name: string }[];
    tags: readonly { id: string; name: string }[];
    sections: readonly { id: string; title: string }[];
  },
): string {
  switch (predicate.p) {
    case "type":
      return `type ${(predicate.ids ?? []).map((id) => lookup.types.find((t) => t.id === id)?.name ?? id).join(", ")}`;
    case "tag":
      return `tag ${(predicate.ids ?? []).map((id) => lookup.tags.find((t) => t.id === id)?.name ?? id).join(", ")}`;
    case "section":
      return `section ${(predicate.ids ?? []).map((id) => lookup.sections.find((s) => s.id === id)?.title ?? id).join(", ")}`;
    case "text":
      return `text “${predicate.terms ?? ""}”`;
    default:
      return predicate.p;
  }
}

/** Whether the query holds anything the Advanced disclosure is hiding. */
export function advancedCount(draft: ViewDraft): number {
  return (draft.query.sorts?.length ?? 0) + (draft.query.groups?.length ?? 0);
}
