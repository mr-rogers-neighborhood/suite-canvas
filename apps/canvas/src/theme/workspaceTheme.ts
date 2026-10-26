import type { StyleColourRole, WorkspaceTheme, WorkspaceThemeMode } from "@suite/graph";
import { themeColours } from "@suite/graph";

/**
 * Where a workspace's own palette lands ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)
 * Q2–Q3).
 *
 * The document names a *role*, never a token: `surface` is "the card's face", so
 * the theme writes the token that role resolves to and every consumer — a card,
 * a panel, the shell — picks it up without knowing a palette exists. Nothing is
 * derived here; a value the theme does not name keeps the built-in token, which
 * is the same rule the style ladder uses for an unset rung.
 */
const ROLE_TOKENS: Record<StyleColourRole, string> = {
  canvas: "--canvas-bg",
  surface: "--surface",
  "surface-strong": "--surface-strong",
  ink: "--ink",
  "ink-muted": "--ink-muted",
  hairline: "--hairline",
  accent: "--accent",
  danger: "--danger",
  success: "--success",
  warning: "--warning",
};

/** The declaration each authored role becomes, in the order the vocabulary lists them. */
export function themeDeclarations(
  theme: WorkspaceTheme | undefined,
  mode: WorkspaceThemeMode,
): Array<{ token: string; value: string }> {
  const colours = themeColours(theme, mode);
  return Object.entries(colours).flatMap(([role, value]) => {
    const token = ROLE_TOKENS[role as StyleColourRole];
    return token ? [{ token, value }] : [];
  });
}

/** Roles this theme speaks for in this mode, for a surface that has to say so. */
export function themedRoles(
  theme: WorkspaceTheme | undefined,
  mode: WorkspaceThemeMode,
): StyleColourRole[] {
  return Object.keys(themeColours(theme, mode)) as StyleColourRole[];
}

/**
 * Paints `root` with the theme's colours for `mode`, and takes back every token it
 * previously wrote — so switching modes or clearing the palette cannot leave a
 * stale colour behind.
 */
export function applyWorkspaceTheme(
  root: HTMLElement,
  theme: WorkspaceTheme | undefined,
  mode: WorkspaceThemeMode,
  applied: Set<string>,
): void {
  for (const token of applied) root.style.removeProperty(token);
  applied.clear();
  for (const { token, value } of themeDeclarations(theme, mode)) {
    root.style.setProperty(token, value);
    applied.add(token);
  }
}
