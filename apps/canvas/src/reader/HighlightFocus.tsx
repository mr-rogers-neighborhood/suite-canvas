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
 * buried in a chapter, so a range there would be chosen blind. So a press raises it — backdrop blurred, the passage
 * alone at reading size — and *this* is where it is taken apart. It also dissolves the gesture conflict that would
 * otherwise need engineering: with parts chosen here, a press no longer has to double as "select inside a highlight".
 *
 * The shape of the surface is the **type's**: one row per slot the type fills, unfilled until words are assigned. That
 * is what "the type knows its properties" means in practice, and it turns the surface from a list of decisions into a
 * form. `Add a part` is the escape hatch, because a mapping somebody wrote last week must never wall a reader in.
 *
 * The passage keeps the highlight's colour — that is what kind of thing this is — and the parts are **dotted** over it
 * in the same colour, because the dots say which words the machine will read.
 */
export interface HighlightFocusProps {
  annotation: Annotation;
  styles: readonly AnnotationStyle[];
  /** The destinations this type fills, in order. These become the surface's rows. */
  slots: readonly AnnotationPartTarget[];
  /** The property names the promoted type has, offered for a part the reader adds beyond the mapping. */
  fieldNames: readonly string[];
  onPlace: (parts: readonly AnnotationPart[]) => void;
  onDone: (parts: readonly AnnotationPart[]) => void;
  onStyle: (styleId: string) => void;
  onRemove: () => void;
  onClose: () => void;
  /** Open the editor for what each type fills, so a mapping is changed where mappings live. */
  onEditTypes?: (() => void) | undefined;
}

/** The label a destination wears on a row. */
export function slotLabel(target: AnnotationPartTarget): string {
  if (target.kind === "title") return "Title";
  if (target.kind === "body") return "The passage";
  if (target.kind === "own-card") return "A card of its own";
  return target.name;
}

export function HighlightFocus({
  annotation,
  styles,
  slots,
  fieldNames,
  onPlace,
  onDone,
  onStyle,
  onRemove,
  onClose,
  onEditTypes,
}: HighlightFocusProps) {
  const quote = annotation.anchor.kind === "quote" ? annotation.anchor.quote : "";
  const [parts, setParts] = useState<AnnotationPart[]>(() =>
    [...(annotation.parts ?? [])].sort((a, b) => a.start - b.start),
  );
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
  /**
   * The row the next selection fills.
   *
   * A slot key arms a destination the type expects; `extra` arms "make a new part and choose where it goes". A reader
   * who has pressed nothing gets `null`, and then a selection offers the choices instead of guessing.
   */
  const [armed, setArmed] = useState<string | null>(null);
  const text = useRef<HTMLParagraphElement | null>(null);
  /** The destinations a reader may pick for a part the type did not expect: the type's own fields first. */
  const offers = useMemo<AnnotationPartTarget[]>(
    () => [...extraTargets, ...fieldNames.map((name) => ({ kind: "field" as const, name }))],
    [fieldNames],
  );

  const style = styles.find((entry) => entry.id === annotation.styleId);
  const tint = style?.color ?? "var(--accent)";
  const covered = useMemo(
    () => new Set(parts.flatMap((part) => range(part.start, part.end))),
    [parts],
  );

  /** The recipe's rows, in order, each paired with the part that fills it. */
  const rows = slots.map((target) => {
    const key = `slot:${targetKey(target)}`;
    return {
      key,
      target,
      part: parts.find((part) => targetKey(part.target) === targetKey(target)),
    };
  });
  /** Parts whose destination the type did not expect: a reader's addition, kept. */
  const extras = parts.filter(
    (part) => !slots.some((target) => targetKey(target) === targetKey(part.target)),
  );

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
    const inside = selected.getRangeAt(0);
    if (!element.contains(inside.commonAncestorContainer)) return;
    const start = offsetWithin(element, inside.startContainer, inside.startOffset);
    const end = offsetWithin(element, inside.endContainer, inside.endOffset);
    if (start === null || end === null) return;
    // Measured against the rendered text, so whitespace collapsing between the two cannot shift a range by a
    // character.
    const rendered = element.textContent ?? "";
    const quoteStart = Math.round((start / Math.max(1, rendered.length)) * quote.length);
    const quoteEnd = Math.round((end / Math.max(1, rendered.length)) * quote.length);
    if (quoteEnd <= quoteStart) return;

    const range = { start: quoteStart, end: quoteEnd };
    const armedTarget = slots.find((target) => `slot:${targetKey(target)}` === armed);
    if (armedTarget !== undefined && armed !== "extra") {
      write(range, armedTarget);
      setArmed(null);
      return;
    }
    setPending(range);
  };

  const write = (range: { start: number; end: number }, target: AnnotationPartTarget) => {
    // A part may not overlap another: two ranges over the same words would both claim them, and which one a card used
    // would then depend on order rather than on the reader.
    const clash = parts.some((part) => range.start < part.end && part.start < range.end);
    if (clash) {
      setPending(null);
      setArmed(null);
      return;
    }
    setParts((current) =>
      [
        ...current.filter((part) => targetKey(part.target) !== targetKey(target)),
        { id: crypto.randomUUID(), start: range.start, end: range.end, target },
      ].sort((a, b) => a.start - b.start),
    );
    setPending(null);
    setArmed(null);
    window.getSelection()?.removeAllRanges();
  };

  const ownCards = parts.filter((part) => part.target.kind === "own-card").length;

  return (
    <div className="raise" data-testid="highlight-raise" role="dialog" aria-label="This highlight">
      <button type="button" className="raise-scrim" aria-label="Close" onClick={onClose} />
      <div className="raise-panel">
        <header className="raise-head">
          <span className="raise-label">{style?.name ?? "Highlight"}</span>
          <span className="raise-count" data-testid="raise-count">
            {parts.length === 0
              ? "The whole passage"
              : `${String(parts.length)} of ${String(Math.max(parts.length, slots.length))} filled`}
          </span>
          {onEditTypes === undefined ? null : (
            <button
              type="button"
              className="views-button views-button--quiet ml-auto"
              data-testid="raise-edit-types"
              onClick={onEditTypes}
            >
              <IconGlyph icon="lucide:sliders-horizontal" size={11} />
              Types
            </button>
          )}
          <button
            type="button"
            className={
              onEditTypes === undefined ? "views-icon-button ml-auto" : "views-icon-button"
            }
            aria-label="Close"
            data-testid="raise-close"
            onClick={onClose}
          >
            <IconGlyph icon="lucide:x" size={14} />
          </button>
        </header>

        <div className="raise-colours">
          {styles.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="raise-colour"
              aria-label={entry.name}
              aria-pressed={entry.id === annotation.styleId}
              title={entry.name}
              data-testid={`raise-style-${entry.id}`}
              style={{ background: entry.color }}
              onClick={() => onStyle(entry.id)}
            />
          ))}
        </div>

        <p
          ref={text}
          className="raise-quote"
          data-testid="raise-quote"
          style={{ background: `color-mix(in srgb, ${tint} 26%, transparent)` }}
          onMouseUp={capture}
        >
          {quote.split("").map((character, index) => (
            <span
              key={String(index)}
              className={covered.has(index) ? "raise-covered" : undefined}
              style={covered.has(index) ? { textDecorationColor: tint } : undefined}
            >
              {character}
            </span>
          ))}
        </p>

        <ul className="raise-parts" data-testid="raise-parts">
          {rows.map((row) => (
            <SlotRow
              key={row.key}
              label={slotLabel(row.target)}
              tint={tint}
              words={row.part === undefined ? null : (partText(annotation, row.part) ?? "…")}
              armed={armed === row.key}
              onArm={() => setArmed(armed === row.key ? null : row.key)}
              onClear={
                row.part === undefined
                  ? undefined
                  : () =>
                      setParts((current) => current.filter((entry) => entry.id !== row.part?.id))
              }
              testId={`raise-slot-${targetKey(row.target)}`}
            />
          ))}
          {extras.map((part) => (
            <SlotRow
              key={part.id}
              label={slotLabel(part.target)}
              tint={tint}
              words={partText(annotation, part) ?? "…"}
              armed
              onArm={() => setArmed(null)}
              onClear={() => setParts((current) => current.filter((entry) => entry.id !== part.id))}
              testId={`raise-part-${part.id}`}
            />
          ))}
        </ul>

        {slots.length === 0 && extras.length === 0 ? (
          <p className="raise-hint" data-testid="raise-hint">
            This type fills nothing yet. Select a passage and place it, or give the type some slots
            in Types.
          </p>
        ) : null}

        {pending === null ? null : (
          <div className="raise-pending" data-testid="raise-pending">
            <span className="raise-part-text">{quote.slice(pending.start, pending.end)}</span>
            {dedupe([...slots, ...offers]).map((target) => (
              <button
                key={targetKey(target)}
                type="button"
                className="views-button"
                data-testid={`raise-as-${targetKey(target)}`}
                onClick={() => write(pending, target)}
              >
                {slotLabel(target)}
              </button>
            ))}
            <NewPropertyTarget onName={(name) => write(pending, { kind: "field", name })} />
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
          <button
            type="button"
            className="views-button views-button--quiet"
            data-testid="raise-add-part"
            title="Map words the type does not expect: choose where they go after selecting them"
            onClick={() => setArmed(armed === "extra" ? null : "extra")}
          >
            {armed === "extra" ? "Select words for a new part…" : "Add a part"}
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

/** One destination, and the words that fill it. Pressing an empty row arms it for the next selection. */
function SlotRow({
  label,
  words,
  armed,
  tint,
  onArm,
  onClear,
  testId,
}: {
  label: string;
  words: string | null;
  armed: boolean;
  tint: string;
  onArm: () => void;
  onClear?: (() => void) | undefined;
  testId: string;
}) {
  return (
    <li
      className="raise-part"
      data-filled={words === null ? undefined : "true"}
      data-armed={armed ? "true" : undefined}
    >
      <button
        type="button"
        className="raise-part-arm"
        data-testid={testId}
        aria-pressed={armed}
        onClick={onArm}
      >
        <span
          aria-hidden="true"
          className="raise-part-dot"
          style={{ borderColor: words === null ? "var(--hairline)" : tint }}
        />
        <span className="raise-part-label">{label}</span>
        <span className="raise-part-text" data-empty={words === null ? "true" : undefined}>
          {words ?? "Select words…"}
        </span>
      </button>
      {onClear === undefined ? null : (
        <button
          type="button"
          className="views-icon-button"
          aria-label={`Clear ${label}`}
          data-testid={`${testId}-clear`}
          onClick={onClear}
        >
          <IconGlyph icon="lucide:x" size={12} />
        </button>
      )}
    </li>
  );
}

/** The destinations offered for a part the type did not expect. */
const extraTargets: readonly AnnotationPartTarget[] = [
  { kind: "title" },
  { kind: "body" },
  { kind: "own-card" },
];

/** A target as a row key, so the recipe and a part can be compared without caring about object identity. */
export function targetKey(target: AnnotationPartTarget): string {
  return target.kind === "field" ? `field:${target.name}` : target.kind;
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

/** One entry per destination, keeping the first sighting so a type's own slots lead. */
function dedupe(targets: readonly AnnotationPartTarget[]): AnnotationPartTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
