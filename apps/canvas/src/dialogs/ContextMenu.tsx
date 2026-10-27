import { useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "../shell/escapeLayers";
import { focusFirstMenuItem, menuKeyDown } from "./menuKeys";

export interface ContextMenuItem {
  label: string;
  onSelect?: () => void;
  danger?: boolean;
  /** Nested menu, e.g. the "Position" submenu. */
  items?: ContextMenuItem[];
  /** A colour dot beside the label, for the palette quick-picks. */
  swatch?: { light: string; dark: string } | undefined;
  /** Marks the swatch this surface already wears. */
  swatchSelected?: boolean | undefined;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const itemClass = (danger?: boolean) =>
  `flex w-full items-center justify-between gap-3 rounded px-3 py-1.5 text-left text-sm ${
    danger
      ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-500/15"
      : "hover:bg-black/5 dark:hover:bg-white/10"
  }`;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  // The menu is portalled at the pointer, which can be at the bottom-right of a
  // narrow pane. Clamp it to the viewport instead of opening off-screen.
  const menuLeft = Math.max(8, Math.min(x, viewportWidth - 208));
  const menuTop = Math.max(8, Math.min(y, viewportHeight - (items.length * 32 + 16)));
  // A submenu that always opens rightward disappears off a narrow window. Flip
  // it to the left of its parent when the menu was opened near the right edge.
  const flipSubmenu = x + 360 > viewportWidth;

  useEscapeLayer(onClose);

  // Portalled: a `position: fixed` menu inside the canvas viewport (or an
  // editor) would be positioned against that transformed ancestor instead of
  // the window, which puts it off-screen.
  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close context menu"
        className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div
        ref={focusFirstMenuItem}
        data-testid="context-menu"
        role="menu"
        className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
        style={{ left: menuLeft, top: menuTop }}
        onKeyDown={menuKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((item) =>
          item.items ? (
            <div key={item.label} className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenu === item.label}
                className={itemClass(item.danger)}
                onMouseEnter={() => setOpenSubmenu(item.label)}
                onFocus={() => setOpenSubmenu(item.label)}
                // Pointer hover already opened it; a click must not toggle it
                // shut again. Escape or an outside click closes the menu.
                onClick={() => setOpenSubmenu(item.label)}
              >
                {item.label}
                <span aria-hidden="true" className="text-xs opacity-60">
                  {"\u25b8"}
                </span>
              </button>
              {openSubmenu === item.label ? (
                <div
                  role="menu"
                  aria-label={item.label}
                  onKeyDown={menuKeyDown}
                  data-testid="context-submenu"
                  className={`absolute top-0 min-w-[170px] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl ${
                    flipSubmenu ? "right-full mr-1" : "left-full ml-1"
                  }`}
                >
                  {item.items.map((subItem) => (
                    <button
                      key={subItem.label}
                      type="button"
                      role="menuitem"
                      className={itemClass(subItem.danger)}
                      onClick={() => {
                        subItem.onSelect?.();
                        onClose();
                      }}
                    >
                      <SwatchLabel item={subItem} />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={itemClass(item.danger)}
              data-swatch-selected={item.swatchSelected ? "true" : undefined}
              onClick={() => {
                item.onSelect?.();
                onClose();
              }}
            >
              <SwatchLabel item={item} />
            </button>
          ),
        )}
      </div>
    </>,
    document.body,
  );
}

/**
 * A palette quick-pick: the colour, then its name.
 *
 * The dot carries both modes as a custom property so the same item reads
 * correctly in light and dark without the menu having to know which is on.
 */
function SwatchLabel({ item }: { item: ContextMenuItem }) {
  if (!item.swatch) return <>{item.label}</>;
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 rounded-full border border-[var(--hairline)]"
          style={
            {
              "--swatch-light": item.swatch.light,
              "--swatch-dark": item.swatch.dark,
              backgroundColor: "var(--swatch-light)",
            } as React.CSSProperties
          }
        />
        <span className="truncate">{item.label}</span>
      </span>
      <span aria-hidden="true" className="text-xs opacity-60">
        {item.swatchSelected ? "\u2713" : ""}
      </span>
    </>
  );
}
