import type { FloatBounds, FloatRect } from "./floatPlan";

/**
 * The chrome a floating surface must not sit under, and the area it may occupy.
 *
 * Pins and the handbook bubble both ask planFloats to keep them clear of things, and both must
 * agree about what "things" are. One list means a pin and the handbook never end up stacked on
 * the inspector by different rules, and adding a surface is one selector rather than one per
 * caller.
 *
 * The handbook is in the list and skips itself: a surface that treats its own rect as an
 * obstacle can never settle anywhere.
 */
export const SHELL_SELECTORS = [
  '[data-testid="title-bar"]',
  '[data-testid="dock"]',
  '[data-testid="card-inspector"]',
  '[data-testid="library-drawer"]',
  '[data-testid="command-palette"]',
  '[data-testid="type-settings"]',
  '[data-handbook-region="handbook-bubble"]',
];

/** What the shell measures now, in viewport coordinates. */
export function shellObstacles(skip?: Element | null): FloatRect[] {
  if (typeof document === "undefined") return [];
  const found: FloatRect[] = [];
  for (const [index, selector] of SHELL_SELECTORS.entries()) {
    const element = document.querySelector(selector);
    if (!element || element === skip) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    found.push({
      id: `shell-${String(index)}`,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }
  return found;
}

/** The area a float may occupy: the window, inset by the gutter a surface needs to breathe. */
export function shellBounds(): FloatBounds {
  if (typeof window === "undefined") return { x: 0, y: 0, width: 0, height: 0 };
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}
