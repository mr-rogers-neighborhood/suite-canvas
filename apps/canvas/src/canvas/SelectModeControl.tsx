import { useState } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import { useUiStore } from "../store/useUiStore";

/**
 * The three things a selection box can pick up, in the order they are offered.
 *
 * Drawn from the app's own icon set rather than from unicode glyphs: a widget in the controls beside `IconGlyph` buttons is
 * read as a different kind of control when its marks come from a different typeface.
 */
const SUBJECTS = [
  { key: "cards", label: "Cards", icon: "lucide:square" },
  { key: "links", label: "Links", icon: "lucide:arrow-left-right" },
  { key: "sections", label: "Sections", icon: "lucide:frame" },
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
        <IconGlyph icon="lucide:box-select" size={13} />
        <span aria-hidden="true" className="select-mode-count">
          {chosen.length}
        </span>
      </button>
      {open ? (
        <fieldset className="select-mode-menu" aria-label="What a selection box picks up">
          {SUBJECTS.map((subject) => {
            // A box has to pick something up: the last one on is the one that cannot be turned off.
            const last = selects[subject.key] && chosen.length === 1;
            return (
              <button
                key={subject.key}
                type="button"
                className="select-mode-row"
                data-testid={`select-mode-${subject.key}`}
                aria-pressed={selects[subject.key]}
                disabled={last}
                title={last ? "A selection box has to pick something up" : undefined}
                onClick={() => toggle(subject.key)}
              >
                <IconGlyph icon={subject.icon} size={12} />
                <span className="select-mode-label">{subject.label}</span>
                <span aria-hidden="true" className="select-mode-tick">
                  <IconGlyph icon={selects[subject.key] ? "lucide:check" : "lucide:x"} size={11} />
                </span>
              </button>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}
