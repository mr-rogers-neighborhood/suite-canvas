import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconGlyph } from "../icons/IconGlyph";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useUiStore } from "../store/useUiStore";

/**
 * The three things a selection box can pick up, in the order they are offered.
 *
 * Cards first, then the frames around them, then the arrows between: the board read top-down.
 * Drawn from the app's own icon set rather than from unicode glyphs: a widget in the controls
 * beside `IconGlyph` buttons is read as a different kind of control when its marks come from a
 * different typeface.
 */
const SUBJECTS = [
  { key: "cards", label: "Cards", icon: "lucide:square" },
  { key: "sections", label: "Sections", icon: "lucide:frame" },
  { key: "links", label: "Links", icon: "lucide:arrow-left-right" },
] as const;

/** Between the toggle and its menu, and between the menu and the window edge. */
const MENU_GAP = 6;
/** Wide enough for "Sections" and its tick. Passed inline, so the measurement and the CSS
 * cannot disagree about how much room the clamp has to leave. */
const MENU_WIDTH = 132;

interface MenuBox {
  left: number;
  bottom: number;
  maxHeight: number;
}

/**
 * What a selection box picks up.
 *
 * A marquee used to box every card it touched and sweep up any section link it crossed, with no
 * way to say which of those the reader meant: a box over a busy board usually wants one of them,
 * and reaching for "these two cards" while dragging near a link meant collecting arrows as well.
 *
 * Three toggles rather than a cycling glyph, because these combine and a cycle cannot show two at
 * once. It opens from one button in the controls, which names the count in force so a closed
 * widget still says what is selected.
 *
 * The menu is a portal, and it has to be: the pill that holds the toggle sets `overflow: hidden`
 * to own its radius, so an absolutely-positioned child was clipped to a 26px column and the
 * button looked dead. A popover over the canvas is also the shape every other menu in the shell
 * has.
 */
export function SelectModeControl() {
  const selects = useUiStore((state) => state.marqueeSelects);
  const toggle = useUiStore((state) => state.toggleMarqueeSelect);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<MenuBox | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLFieldSetElement>(null);

  // Bottom-aligned with the toggle and to the right of the pill, clamped into the window: the
  // pill sits on the floor of the canvas, so the menu grows upward from it.
  const place = useCallback(() => {
    const anchor = button.current?.getBoundingClientRect();
    if (!anchor) return;
    setBox({
      left: Math.max(12, Math.min(anchor.right + MENU_GAP, window.innerWidth - MENU_WIDTH - 12)),
      bottom: Math.max(12, window.innerHeight - anchor.bottom),
      maxHeight: Math.max(120, anchor.bottom - 12),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  const close = useCallback(() => setOpen(false), []);
  useEscapeLayer(close, open);

  // A press anywhere else puts the menu away, including one that starts a box: the mode is a
  // setting, and a setting left open over the gesture it changes is in the way.
  useEffect(() => {
    if (!open) return;
    const press = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (menu.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", press, true);
    return () => window.removeEventListener("pointerdown", press, true);
  }, [open]);

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
        ref={button}
        type="button"
        className="select-mode-toggle"
        data-testid="select-mode-toggle"
        aria-expanded={open}
        aria-controls="select-mode-menu"
        aria-label={`A selection box picks up ${summary}. Change what it picks up`}
        title={`Boxing picks up ${summary}`}
        onClick={() => setOpen((current) => !current)}
      >
        <IconGlyph icon="lucide:box-select" size={13} />
        <span aria-hidden="true" className="select-mode-count">
          {chosen.length}
        </span>
      </button>
      {open
        ? createPortal(
            <fieldset
              ref={menu}
              id="select-mode-menu"
              data-testid="select-mode-menu"
              className="select-mode-menu"
              aria-label="What a selection box picks up"
              style={
                box
                  ? {
                      left: box.left,
                      bottom: box.bottom,
                      maxHeight: box.maxHeight,
                      width: MENU_WIDTH,
                    }
                  : { visibility: "hidden", width: MENU_WIDTH }
              }
            >
              {SUBJECTS.map((subject) => {
                // A box has to pick something up. Rather than disabling the last row — a dead
                // control inside a menu that has just opened — its press closes the menu and
                // leaves the subject on, which is the second way out a popover is expected to
                // have.
                const last = selects[subject.key] && chosen.length === 1;
                return (
                  <button
                    key={subject.key}
                    type="button"
                    className="select-mode-row"
                    data-testid={`select-mode-${subject.key}`}
                    aria-pressed={selects[subject.key]}
                    title={
                      last
                        ? `${subject.label} is the only thing a box picks up. Pressing this closes the menu`
                        : undefined
                    }
                    onClick={() => {
                      if (last) setOpen(false);
                      else toggle(subject.key);
                    }}
                  >
                    <IconGlyph icon={subject.icon} size={12} />
                    <span className="select-mode-label">{subject.label}</span>
                    <span aria-hidden="true" className="select-mode-tick">
                      <IconGlyph
                        icon={selects[subject.key] ? "lucide:check" : "lucide:x"}
                        size={11}
                      />
                    </span>
                  </button>
                );
              })}
            </fieldset>,
            document.body,
          )
        : null}
    </div>
  );
}
