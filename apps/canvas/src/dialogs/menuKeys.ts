import type { KeyboardEvent } from "react";

const ITEM = "[role='menuitem']:not([disabled])";
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * Arrow-key movement for a `role="menu"` container.
 *
 * The role promises menu behaviour: Up and Down move between items, Home and End
 * jump to the ends. Every menu in the shell declared the role and shipped only
 * Tab, so a reader whose screen reader announced "menu" found the keys that role
 * implies did nothing.
 *
 * Items belong to the nearest menu, so a nested submenu lists only its own rows.
 */
export function menuKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (!NAV_KEYS.has(event.key)) return;

  const menu = event.currentTarget;
  const items = [...menu.querySelectorAll<HTMLElement>(ITEM)].filter(
    (item) => item.closest("[role='menu']") === menu,
  );
  if (items.length === 0) return;

  event.preventDefault();
  const focused = document.activeElement;
  const current = focused instanceof HTMLElement ? items.indexOf(focused) : -1;
  const target =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current <= 0 ? items.length : current) - 1;
  items[target]?.focus();
}
