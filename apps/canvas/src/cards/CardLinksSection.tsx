import { useState } from "react";
import { Section } from "./CardPanelSection";
import type { CardLinks, LinkProvenance, LinkRow } from "./cardLinks";

const referenceRowClass =
  "flex w-full min-w-0 items-start gap-1.5 rounded px-1 py-0.5 text-left text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10";

const referenceMetaClass = "mt-0.5 block truncate text-[11px] text-[var(--ink-muted)]";

/** One row per related card; provenance rides along as quiet markers. */
const PROVENANCE: Record<LinkProvenance, { glyph: string; label: string }> = {
  mention: { glyph: "\u270e", label: "Mentioned in the body" },
  property: { glyph: "\u25a4", label: "Property value" },
  arrow: { glyph: "\u2197", label: "Arrow on a board" },
};

const occurrenceClass =
  "flex min-w-0 items-start gap-1 pl-4 pr-1 py-0.5 text-[11px] text-[var(--ink-muted)]";

function LinkRowItem({
  row,
  direction,
  onFocus,
  inert = false,
}: {
  row: LinkRow;
  direction: "in" | "out";
  onFocus: (cardId: string, boardId: string | null) => void;
  /** The card is not part of this share, so the row reads but does not navigate. */
  inert?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // One occurrence is already described on the row, so expanding only earns
  // its keep when a pair is joined more than once.
  const expandable = row.occurrences.length > 1;
  const single = row.occurrences.length === 1 ? row.occurrences[0]?.detail : undefined;
  const meta = [single ?? row.relationship, row.boardName]
    .filter((part): part is string => Boolean(part))
    .join(" \u00b7 ");

  const body = (
    <>
      <span aria-hidden="true" className="shrink-0 text-[12px] leading-5 text-[var(--ink-muted)]">
        {row.glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{row.title}</span>
        {meta ? <span className={referenceMetaClass}>{meta}</span> : null}
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 leading-5 text-[11px] text-[var(--ink-muted)]"
        data-testid="link-markers"
      >
        {row.kinds.map((kind) => PROVENANCE[kind].glyph).join("")}
        {row.mutual ? "\u2194" : ""}
      </span>
    </>
  );

  return (
    <li data-testid="link-row" data-direction={direction} data-card-id={row.cardId}>
      <div className="flex items-start gap-1">
        {inert ? (
          <span
            title={`${row.title} is not part of this share`}
            aria-disabled="true"
            data-testid="link-row-inert"
            className={`${referenceRowClass} cursor-default text-[var(--ink-muted)] opacity-70 hover:bg-transparent`}
          >
            {body}
          </span>
        ) : (
          <button
            type="button"
            title={row.title}
            className={referenceRowClass}
            onClick={() => onFocus(row.cardId, row.boardId)}
          >
            {body}
          </button>
        )}
        {expandable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} ${row.occurrences.length} links to ${row.title}`}
            data-testid="link-occurrences-toggle"
            className="shrink-0 rounded px-1 text-[10px] leading-5 text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "\u25be" : "\u25b8"}
          </button>
        ) : null}
      </div>
      {open ? (
        <ul className="space-y-0.5" data-testid="link-occurrences">
          {row.occurrences.map((occurrence) => (
            <li
              key={occurrence.key}
              data-testid="link-occurrence"
              data-kind={occurrence.kind}
              className={occurrenceClass}
            >
              <span aria-hidden="true" className="shrink-0 leading-4">
                {PROVENANCE[occurrence.kind].glyph}
              </span>
              <span className="min-w-0 flex-1 truncate" title={occurrence.detail}>
                {occurrence.detail ?? PROVENANCE[occurrence.kind].label}
              </span>
              {occurrence.boardName ? (
                <span className="shrink-0">{occurrence.boardName}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function LinkGroup({
  title,
  direction,
  rows,
  onFocus,
  availableCardIds,
}: {
  title: string;
  direction: "in" | "out";
  rows: LinkRow[];
  onFocus: (cardId: string, boardId: string | null) => void;
  /** Cards this surface may open; the rest render as inert rows. */
  availableCardIds?: ReadonlySet<string>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-0.5" data-testid={`links-${direction}`}>
      <h3 className="text-[11px] text-[var(--ink-muted)]">{title}</h3>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <LinkRowItem
            key={row.cardId}
            row={row}
            direction={direction}
            onFocus={onFocus}
            {...(availableCardIds && !availableCardIds.has(row.cardId) ? { inert: true } : {})}
          />
        ))}
      </ul>
    </div>
  );
}

/** The card's relations: one row per related card, both directions. */
export function CardLinksSection({
  links,
  onFocusLink,
  availableCardIds,
}: {
  links: CardLinks;
  onFocusLink: (cardId: string, boardId: string | null) => void;
  /** Cards this surface may open; the rest render as inert rows. */
  availableCardIds?: ReadonlySet<string>;
}) {
  const hasLinks = links.incoming.length + links.outgoing.length > 0;
  const restricted = availableCardIds ? { availableCardIds } : {};
  return (
    <Section title="Links">
      <div className="space-y-2.5" data-testid="card-links">
        {hasLinks ? (
          <>
            <LinkGroup
              title="Incoming"
              direction="in"
              rows={links.incoming}
              onFocus={onFocusLink}
              {...restricted}
            />
            <LinkGroup
              title="Outgoing"
              direction="out"
              rows={links.outgoing}
              onFocus={onFocusLink}
              {...restricted}
            />
          </>
        ) : (
          <p className="text-[12px] text-[var(--ink-muted)]" data-testid="links-empty">
            No links yet. Type @ in a card, or draw an arrow between two cards.
          </p>
        )}
      </div>
    </Section>
  );
}
