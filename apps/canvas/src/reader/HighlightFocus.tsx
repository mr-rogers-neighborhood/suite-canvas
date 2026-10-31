import type {
  Annotation,
  AnnotationPart,
  AnnotationPartTarget,
  AnnotationStyle,
} from "@suite/graph";
import { partText } from "@suite/graph";
import { useMemo, useRef, useState } from "react";
import { IconGlyph } from "../icons/IconGlyph";

/**
 * One highlight, raised.
 *
 * A paragraph-long highlight cannot be broken apart where it sits: the concept is mid-sentence and the sentence is
 * buried in a chapter, so selecting a range there means selecting blind. So a press on a highlight raises it —
 * backdrop blurred, the quote alone at reading size — and *this* is where it is taken apart.
 *
 * It also dissolves a gesture conflict that would otherwise need engineering: a press can raise, because selecting a
 * range inside a highlight no longer has to happen in the flowing text.
 *
 * Everything here is a draft until **Done** or **Place**. A reader trying three ways of cutting a sentence should not
 * write three times, so the parts are local state and the caller `key`s this surface on the highlight: a different
 * highlight is a different draft, and the same one never resets under the reader's hands.
 */
export interface HighlightFocusProps {
  annotation: Annotation;
  styles: readonly AnnotationStyle[];
  /** The field names the promoted type already has, offered before "a new one". */
  fieldNames: readonly string[];
  /** What Place would make, so the button can say it: one card, or one plus its parts. */
  onPlace: (parts: readonly AnnotationPart[]) => void;
  onDone: (parts: readonly AnnotationPart[]) => void;
  onStyle: (styleId: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

const TARGETS: { value: string; label: string }[] = [
  { value: "title", label: "The card's title" },
  { value: "body", label: "Only the passage" },
  { value: "own-card", label: "A card of its own" },
];

export function HighlightFocus({
  annotation,
  styles,
  fieldNames,
  onPlace,
  onDone,
  onStyle,
  onRemove,
  onClose,
}: HighlightFocusProps) {
  const quote = annotation.anchor.kind === "quote" ? annotation.anchor.quote : "";
  const [parts, setParts] = useState<AnnotationPart[]>(() =>
    [...(annotation.parts ?? [])].sort((a, b) => a.start - b.start),
  );
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
  const text = useRef<HTMLParagraphElement | null>(null);

  const covered = useMemo(
    () => new Set(parts.flatMap((part) => range(part.start, part.end))),
    [parts],
  );
  const ownCards = parts.filter((part) => part.target.kind === "own-card").length;

  /** The words a reader selected, as offsets into the quote the surface is showing. */
  const capture = () => {
    const element = text.current;
    const selected = window.getSelection();
    if (
      element === null ||
      selected === null ||
      selected.isCollapsed ||
      selected.rangeCount === 0
    ) {
      setPending(null);
      return;
    }
    const rangeInside = selected.getRangeAt(0);
    if (!element.contains(rangeInside.commonAncestorContainer)) return;
    // Measured against the rendered text rather than the stored quote, so whitespace collapsing between the two
    // cannot shift a range by a character.
    const rendered = element.textContent ?? "";
    const start = offsetWithin(element, rangeInside.startContainer, rangeInside.startOffset);
    const end = offsetWithin(element, rangeInside.endContainer, rangeInside.endOffset);
    if (start === null || end === null) return;
    const startRatio = rendered.length === 0 ? 0 : start / rendered.length;
    const endRatio = rendered.length === 0 ? 0 : end / rendered.length;
    const quoteStart = Math.round(startRatio * quote.length);
    const quoteEnd = Math.round(endRatio * quote.length);
    if (quoteEnd <= quoteStart) return;
    setPending({ start: quoteStart, end: quoteEnd });
  };

  const assign = (target: AnnotationPartTarget) => {
    if (pending === null) return;
    // A part may not overlap another: two ranges over the same words would both claim them, and which one a card
    // used would depend on order rather than on the reader.
    const clash = parts.some((part) => pending.start < part.end && part.start < pending.end);
    if (clash) {
      setPending(null);
      return;
    }
    setParts((current) =>
      [
        ...current,
        { id: crypto.randomUUID(), start: pending.start, end: pending.end, target },
      ].sort((a, b) => a.start - b.start),
    );
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="raise" data-testid="highlight-raise" role="dialog" aria-label="This highlight">
      <button type="button" className="raise-scrim" aria-label="Close" onClick={onClose} />
      <div className="raise-panel">
        <header className="raise-head">
          <span className="raise-label">Highlight</span>
          <span className="raise-count" data-testid="raise-count">
            {parts.length === 0
              ? "Whole passage"
              : `${parts.length} part${parts.length === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            className="views-icon-button ml-auto"
            aria-label="Close"
            data-testid="raise-close"
            onClick={onClose}
          >
            <IconGlyph icon="lucide:x" size={14} />
          </button>
        </header>

        <div className="raise-colours">
          {styles.map((style) => (
            <button
              key={style.id}
              type="button"
              className="raise-colour"
              aria-label={style.name}
              aria-pressed={style.id === annotation.styleId}
              title={style.name}
              data-testid={`raise-style-${style.id}`}
              style={{ background: style.color }}
              onClick={() => onStyle(style.id)}
            />
          ))}
        </div>

        <p ref={text} className="raise-quote" data-testid="raise-quote" onMouseUp={capture}>
          {quote.split("").map((character, index) => (
            <span
              key={`${String(index)}`}
              className={covered.has(index) ? "raise-covered" : undefined}
              data-index={index}
            >
              {character}
            </span>
          ))}
        </p>

        {parts.length === 0 ? (
          <p className="raise-hint" data-testid="raise-hint">
            Select the words that matter and say where they go. A part can become the card's title,
            a property, or a card of its own.
          </p>
        ) : (
          <ul className="raise-parts" data-testid="raise-parts">
            {parts.map((part) => (
              <li key={part.id} className="raise-part">
                <span className="raise-part-text">{partText(annotation, part) ?? "…"}</span>
                <span className="raise-part-arrow" aria-hidden="true">
                  →
                </span>
                <select
                  className="raise-part-target"
                  aria-label="Where this part goes"
                  value={targetValue(part.target)}
                  data-testid={`raise-target-${part.id}`}
                  onChange={(event) => {
                    const next = parseTarget(event.target.value);
                    setParts((current) =>
                      current.map((entry) =>
                        entry.id === part.id ? { ...entry, target: next } : entry,
                      ),
                    );
                  }}
                >
                  {TARGETS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {fieldNames.map((name) => (
                    <option key={name} value={`field:${name}`}>
                      {name}
                    </option>
                  ))}
                  <option value="field:__new">A new property…</option>
                </select>
                <button
                  type="button"
                  className="views-icon-button"
                  aria-label="Remove this part"
                  data-testid={`raise-part-remove-${part.id}`}
                  onClick={() =>
                    setParts((current) => current.filter((entry) => entry.id !== part.id))
                  }
                >
                  <IconGlyph icon="lucide:x" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {pending === null ? null : (
          <div className="raise-pending" data-testid="raise-pending">
            <span className="raise-part-text">{quote.slice(pending.start, pending.end)}</span>
            <button
              type="button"
              className="views-button"
              data-testid="raise-as-title"
              onClick={() => assign({ kind: "title" })}
            >
              Title
            </button>
            <button
              type="button"
              className="views-button"
              data-testid="raise-as-body"
              onClick={() => assign({ kind: "body" })}
            >
              Passage
            </button>
            <button
              type="button"
              className="views-button"
              data-testid="raise-as-own-card"
              onClick={() => assign({ kind: "own-card" })}
            >
              Own card
            </button>
            <NewPropertyTarget onName={(name) => assign({ kind: "field", name })} />
          </div>
        )}

        <footer className="raise-foot">
          <button
            type="button"
            className="views-button views-button--quiet"
            data-testid="raise-remove"
            onClick={onRemove}
          >
            Remove
          </button>
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="views-button views-button--quiet"
              data-testid="raise-done"
              onClick={() => onDone(parts)}
            >
              Done
            </button>
            <button
              type="button"
              className="views-button views-button--primary"
              data-testid="raise-place"
              onClick={() => onPlace(parts)}
            >
              {ownCards === 0
                ? annotation.cardId === undefined
                  ? "Place"
                  : "Open its card"
                : `Place ${String(ownCards + 1)} cards`}
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}

/** A target as the select spells it. */
function targetValue(target: AnnotationPartTarget): string {
  if (target.kind === "field") return `field:${target.name}`;
  return target.kind;
}

function parseTarget(value: string): AnnotationPartTarget {
  if (value === "title") return { kind: "title" };
  if (value === "own-card") return { kind: "own-card" };
  if (value === "body") return { kind: "body" };
  if (value === "field:__new") return { kind: "field", name: "Property" };
  return { kind: "field", name: value.slice("field:".length) };
}

/** The property name a part is for, asked once, because a name is what a recipe survives on. */
function NewPropertyTarget({ onName }: { onName: (name: string) => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        className="views-button"
        data-testid="raise-as-property"
        onClick={() => setAsking(true)}
      >
        Property…
      </button>
    );
  }
  return (
    <input
      className="views-input w-28"
      // biome-ignore lint/a11y/noAutofocus: the field exists because the reader asked to name a property.
      autoFocus
      aria-label="Property name"
      placeholder="Property name"
      data-testid="raise-property-name"
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        const name = event.currentTarget.value.trim();
        if (name.length > 0) onName(name);
        setAsking(false);
      }}
      onBlur={() => setAsking(false)}
    />
  );
}

/** Every index a range covers, so a covered character can be painted. */
function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let at = start; at < end; at += 1) out.push(at);
  return out;
}

/** A text offset in the rendered paragraph, counting the text nodes before one node. */
function offsetWithin(root: HTMLElement, node: Node, offset: number): number | null {
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
    if (current === node) return total + offset;
    total += current.nodeValue?.length ?? 0;
  }
  return null;
}
