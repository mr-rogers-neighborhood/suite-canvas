import type { KeyboardEvent } from "react";

const ITEM = [
  "[role='menuitem']:not([disabled])",
  "[role='menuitemradio']:not([disabled])",
  "[role='menuitemcheckbox']:not([disabled])",
].join(", ");
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

function itemsIn(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(ITEM)].filter(
    (item) => item.closest("[role='menu']") === menu,
  );
}

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
  const items = itemsIn(menu);
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

/**
 * Move focus into the menu when it opens.
 *
 * `menuKeyDown` listens on the menu, so it only fires while focus is inside it. A
 * menu that opened under a trigger that kept focus therefore never saw a key,
 * and the role promised arrows that could not arrive. Pass this as the menu's
 * `ref`: React calls it on mount, before the browser paints the first frame.
 */
export function focusFirstMenuItem(menu: HTMLElement | null): (() => void) | undefined {
  if (menu === null) return;
  const active = document.activeElement;
  const opener = active instanceof HTMLElement && active !== document.body ? active : null;
  const [first] = itemsIn(menu);
  first?.focus();
  // Escape closes the menu from inside it, which unmounts the row that had focus.
  // Hand focus back to whatever opened the menu, unless something already took
  // it: a row that opens a dialog leaves focus to that dialog's own trap.
  return () => {
    const current = document.activeElement;
    if (current !== null && current !== document.body && !menu.contains(current)) return;
    if (opener?.isConnected === true) opener.focus();
  };
}
