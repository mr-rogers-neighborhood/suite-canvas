import type { ReactNode } from "react";
import { PORTAL_GLYPH } from "../cards/portal";
import { focusFirstMenuItem, menuKeyDown } from "../dialogs/menuKeys";
import type { NewThingMenuModel } from "./newThingMenu";

/** A sketch's glyph, drawn as text: the type is a runtime one, not an icon. */
export const SKETCH_GLYPH = "\u270e";
export const SECTION_GLYPH = "\u25a2";

const rowClass =
  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10";
const glyphClass = "w-4 text-center text-[var(--ink-muted)]";

export interface NewThingMenuProps {
  model: NewThingMenuModel;
  /** Which way the list opens: the dock sits at the bottom, the library at the top. */
  direction: "up" | "down";
  /**
   * What the rows are called in the DOM: `dock-type-note`, `library-type-note`, and
   * so on. One menu, two surfaces, and each surface keeps the ids its specs know.
   */
  prefix: "dock" | "library";
  /** Rows this surface owns, drawn under the shared ones (the dock's type settings). */
  trailing?: ReactNode;
  onCreateCard: (typeId: string) => void;
  /** The portal row's own submenu is open, and this is the caller's state for it. */
  portalOpen: boolean;
  onTogglePortal: () => void;
  /** Every row closes the menu before it runs, so a menu is never left behind. */
  onDone: () => void;
}

/**
 * The rows every "new thing" surface offers: the types a reader authors, the two
 * runtime things that are not types, and the portal with its targets.
 *
 * One renderer for the dock and the library, so a verb cannot read differently in
 * one of them, and a row that cannot run is absent from both.
 */
export function NewThingMenu({
  model,
  direction,
  prefix,
  trailing,
  onCreateCard,
  portalOpen,
  onTogglePortal,
  onDone,
}: NewThingMenuProps) {
  const { creatableTypes, sketch, section, board, portal } = model;
  const hasRuntimeRows = sketch !== null || section !== null;
  const portalAction = portal !== null && (portal.targets.length > 0 || portal.newBoard);

  return (
    <div
      ref={focusFirstMenuItem}
      role="menu"
      data-handbook-region="new-thing-menu"
      data-testid={`${prefix}-type-menu`}
      data-direction={direction}
      onKeyDown={menuKeyDown}
      className={`absolute z-50 w-48 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl ${
        direction === "up"
          ? "bottom-full left-1/2 mb-2 -translate-x-1/2 overflow-visible"
          : "left-0 top-full mt-1 max-h-[min(60vh,24rem)] overflow-y-auto"
      }`}
    >
      {creatableTypes.map((type) => (
        <button
          key={type.id}
          type="button"
          role="menuitem"
          data-testid={`${prefix}-type-${type.id}`}
          className={rowClass}
          onClick={() => {
            onDone();
            onCreateCard(type.id);
          }}
        >
          <span aria-hidden="true" className={glyphClass}>
            {type.glyph}
          </span>
          <span className="min-w-0 flex-1 truncate">{type.name}</span>
        </button>
      ))}

      {hasRuntimeRows ? <div className="my-1 h-px bg-[var(--hairline)]" /> : null}
      {sketch === null ? null : (
        <button
          type="button"
          role="menuitem"
          data-testid={`${prefix}-new-sketch`}
          className={rowClass}
          onClick={() => {
            onDone();
            sketch.run();
          }}
        >
          <span aria-hidden="true" className={glyphClass}>
            {SKETCH_GLYPH}
          </span>
          <span className="min-w-0 flex-1 truncate">{sketch.label}</span>
        </button>
      )}
      {section === null ? null : (
        <button
          type="button"
          role="menuitem"
          data-testid={`${prefix}-new-section`}
          className={rowClass}
          onClick={() => {
            onDone();
            section.run();
          }}
        >
          <span aria-hidden="true" className={glyphClass}>
            {SECTION_GLYPH}
          </span>
          <span className="min-w-0 flex-1 truncate">{section.label}</span>
        </button>
      )}

      {portalAction ? (
        <>
          <div className="my-1 h-px bg-[var(--hairline)]" />
          {/* A portal is seeded as a type but always needs a board to open, so it is
              filtered out of the list above and offered here with its targets. */}
          <div className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={portalOpen}
              data-testid={`${prefix}-new-portal`}
              className={rowClass}
              onClick={onTogglePortal}
            >
              <span aria-hidden="true" className={glyphClass}>
                {PORTAL_GLYPH}
              </span>
              <span className="min-w-0 flex-1 truncate">{portal.label}</span>
              <span aria-hidden="true" className="text-xs opacity-60">
                {"\u25b8"}
              </span>
            </button>
            {/* The dock opens upward from the bottom edge, where there is no room
                beside it, so its targets float out to the right. The library is a
                narrow panel that clips, so there the targets open in place. */}
            {portalOpen ? (
              <div
                role="menu"
                aria-label="New portal"
                data-testid={`${prefix}-portal-menu`}
                onKeyDown={menuKeyDown}
                className={
                  direction === "up"
                    ? "absolute bottom-0 left-full ml-1 min-w-[170px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
                    : "mt-0.5 rounded-lg border border-[var(--hairline)] p-1"
                }
              >
                {portal.targets.map((target) => (
                  <button
                    key={target.key}
                    type="button"
                    role="menuitem"
                    data-testid={`${prefix}-portal-${target.key}`}
                    className={rowClass}
                    onClick={() => {
                      onDone();
                      target.run();
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{target.label}</span>
                  </button>
                ))}
                {portal.newBoard && portal.createBoardPortal !== null ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`${prefix}-portal-new-board`}
                    className={`${rowClass} text-[var(--ink-muted)]`}
                    onClick={() => {
                      onDone();
                      portal.createBoardPortal?.();
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">New board and portal</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      {board === null ? null : (
        <button
          type="button"
          role="menuitem"
          data-testid={`${prefix}-new-board`}
          className={rowClass}
          onClick={() => {
            onDone();
            board.run();
          }}
        >
          <span aria-hidden="true" className={glyphClass}>
            {"\u25a4"}
          </span>
          <span className="min-w-0 flex-1 truncate">{board.label}</span>
        </button>
      )}
      {trailing}
    </div>
  );
}
