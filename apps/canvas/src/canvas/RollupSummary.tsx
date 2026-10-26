import { useState } from "react";
import { type Rollup, rollupSummary } from "./rollup";

export interface RollupSummaryProps {
  rollup: Rollup;
  /** Expanded lists every member; collapsed is the header line and nothing else. */
  defaultExpanded?: boolean;
  /** The way back to what the header counts. */
  onOpen?: ((cardId: string) => void) | undefined;
}

/**
 * A card reduced to its header line (ADR-0060).
 *
 * The header is the only chrome, and it says one thing: how many cards this one hides,
 * with the rows to prove it one press away. The number comes from `rollupSummary`, which
 * reads `rollup.members`, so the header and the list cannot drift apart.
 *
 * A member row is a button rather than a link, because opening a card is a selection in
 * this workspace and not a route. Every row is reachable by Tab, so the summary is usable
 * without a pointer.
 */
export function RollupSummary({ rollup, defaultExpanded = false, onOpen }: RollupSummaryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const label = rollupSummary(rollup);
  const hasMembers = rollup.count > 0;

  return (
    <section
      className="flex max-w-[320px] flex-col rounded-xl border border-[var(--hairline)] bg-[var(--surface)] text-[12px] text-[var(--ink)] shadow-sm"
      data-testid="rollup-summary"
      data-card-id={rollup.cardId}
      aria-label={`${rollup.title} rollup`}
    >
      <button
        type="button"
        className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
        data-testid="rollup-header"
        aria-expanded={expanded}
        aria-controls={`rollup-members-${rollup.cardId}`}
        // A summary with nothing under it is a line, not a disclosure: saying "expanded"
        // about an empty list would promise rows that do not exist.
        disabled={!hasMembers}
        onClick={() => setExpanded((open) => !open)}
      >
        <span aria-hidden="true" className="text-[var(--ink-muted)]">
          {hasMembers ? (expanded ? "\u25be" : "\u25b8") : "\u00b7"}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{rollup.title}</span>
        <span className="shrink-0 text-[var(--ink-muted)]" data-testid="rollup-count">
          {label}
        </span>
      </button>

      {expanded && hasMembers ? (
        <ul
          className="flex flex-col gap-0.5 border-t border-[var(--hairline)] px-1 py-1"
          id={`rollup-members-${rollup.cardId}`}
          data-testid="rollup-members"
        >
          {rollup.members.map((member) => (
            <li key={member.cardId}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-black/5 dark:hover:bg-white/10"
                data-testid="rollup-member"
                data-card-id={member.cardId}
                onClick={() => onOpen?.(member.cardId)}
              >
                <span className="min-w-0 flex-1 truncate">{member.title}</span>
                <span className="shrink-0 text-[var(--ink-muted)]">{member.kind}</span>
                {member.onBoard ? null : (
                  <span
                    className="shrink-0 rounded-full bg-[var(--segmented-bg)] px-1.5 text-[11px] text-[var(--ink-muted)]"
                    data-testid="rollup-member-elsewhere"
                    title="Not on this board"
                  >
                    elsewhere
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
