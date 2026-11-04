import type { ReactNode } from "react";
import type { EntityKind } from "../entities/kind";
import type { InspectorTabId } from "./capabilities";

/**
 * The inspector as a table of rows.
 *
 * Every panel used to lay its body out itself: a card's details were five components in a fixed
 * order, a section's were a `tab === "details"` branch, a link's were one long column with no tabs.
 * The capability table already said *which* tabs a kind has; this says what fills them, and a panel
 * becomes the loop that renders the rows its subject is entitled to.
 *
 * A row owns its own markup and takes one context, so a row can move between panels without its
 * callers changing. The context is deliberately the model the panel already built rather than the
 * workspace: a row describes what it is handed, and the panel is what decides where the data came from.
 */
export interface InspectorRow<Context> {
  id: string;
  tab: InspectorTabId;
  /** The kinds this row can describe. It renders only when it serves the whole subject. */
  kinds: readonly EntityKind[];
  render: (context: Context) => ReactNode;
}

/**
 * The rows of `tab` that serve every kind asked for.
 *
 * Intersection, not union: a card and a section share a colour row, but only a card has properties, so
 * a mixed selection shows neither. The same rule the capability table applies to tabs.
 */
export function rowsFor<Context>(
  rows: readonly InspectorRow<Context>[],
  tab: InspectorTabId,
  kinds: readonly EntityKind[],
): InspectorRow<Context>[] {
  const wanted = new Set(kinds);
  if (wanted.size === 0) return [];
  return rows.filter(
    (row) => row.tab === tab && [...wanted].every((kind) => row.kinds.includes(kind)),
  );
}
