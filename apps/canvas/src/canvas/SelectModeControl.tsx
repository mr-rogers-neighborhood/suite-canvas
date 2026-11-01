import { useState } from "react";
import { useUiStore } from "../store/useUiStore";

/** The three things a selection box can pick up, in the order they are offered. */
const SUBJECTS = [
  { key: "cards", label: "Cards", glyph: "\u25a1" },
  { key: "links", label: "Links", glyph: "\u2194" },
  { key: "sections", label: "Sections", glyph: "\u25ad" },
] as const;

/**
 * What a selection box picks up.
 *
 * A marquee used to box every card it touched and sweep up any section link it crossed, with no way to say which of those
 * the reader meant: a box over a busy board usually wants one of them, and reaching for "these two cards" while dragging
 * near a link meant collecting arrows as well.
 *
 * Three toggles rather than a cycling glyph, because these combine and a cycle cannot show two at once. It opens from one
 * button in the controls, which names the count in force so a closed widget still says what is selected.
 */
export function SelectModeControl() {
  const selects = useUiStore((state) => state.marqueeSelects);
  const toggle = useUiStore((state) => state.toggleMarqueeSelect);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const [open, setOpen] = useState(false);
  // A viewer boxes nothing, so the control would change a mode that does nothing.
  if (!canEditLayout) return null;

  const chosen = SUBJECTS.filter((subject) => selects[subject.key]);
  const summary =
    chosen.length === SUBJECTS.length
      ? "everything"
      : chosen.length === 0
        ? "nothing"
        : chosen.map((subject) => subject.label.toLowerCase()).join(" and ");

  return (
    <div className="select-mode">
      <button
        type="button"
        className="select-mode-toggle"
        data-testid="select-mode-toggle"
        aria-expanded={open}
        aria-label={`A selection box picks up ${summary}. Change what it picks up`}
        title={`Boxing picks up ${summary}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true" className="select-mode-glyph">
          {"\u2b1a"}
        </span>
        <span aria-hidden="true" className="select-mode-count">
          {chosen.length}
        </span>
      </button>
      {open ? (
        <fieldset className="select-mode-menu" aria-label="What a selection box picks up">
          {SUBJECTS.map((subject) => (
            <button
              key={subject.key}
              type="button"
              className="select-mode-row"
              data-testid={`select-mode-${subject.key}`}
              aria-pressed={selects[subject.key]}
              onClick={() => toggle(subject.key)}
            >
              <span aria-hidden="true" className="select-mode-glyph">
                {subject.glyph}
              </span>
              <span className="select-mode-label">{subject.label}</span>
              <span aria-hidden="true" className="select-mode-tick">
                {selects[subject.key] ? "\u2713" : ""}
              </span>
            </button>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
