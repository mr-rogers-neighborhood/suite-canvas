import {
  type StyleColourRole,
  styleColourRoles,
  themeColours,
  type WorkspaceDocument,
  type WorkspaceTheme,
} from "@suite/graph";
import { useId } from "react";
import { useWorkspaceTheme } from "../../theme/useWorkspaceTheme";

/**
 * The workspace's own palette, per mode ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)
 * Q2–Q3).
 *
 * It edits *roles*, never colours-in-the-abstract: `surface` is the card's face,
 * so a value written here is what every surface wearing that role resolves to, in
 * the mode it was written for. The two columns are the two modes on purpose — a
 * palette that only names the light one is a palette a dark-mode visitor never
 * sees, and the honest thing to do is show the gap.
 *
 * Typed values rather than a colour picker: the vocabulary already carries
 * `rgba(…)` and `color-mix(…)`, and a picker would refuse half of what the tokens
 * themselves contain. An empty field means "keep the built-in token".
 */
export function WorkspaceThemeEditor({
  workspace,
  canEdit,
}: {
  workspace: WorkspaceDocument;
  canEdit: boolean;
}) {
  const theme = useWorkspaceTheme(workspace);
  const heading = useId();

  const write = (mode: "light" | "dark", role: StyleColourRole, value: string) => {
    if (!canEdit) return;
    const next: WorkspaceTheme = {
      light: { ...theme?.light },
      dark: { ...theme?.dark },
    };
    const trimmed = value.trim();
    if (trimmed.length > 0) next[mode][role] = trimmed;
    else delete next[mode][role];
    workspace.setWorkspaceTheme(next);
  };

  return (
    <section aria-labelledby={heading} data-testid="workspace-theme">
      <header className="mb-3 border-b border-[var(--hairline)] pb-2">
        <h2 id={heading} className="text-[13px] font-semibold text-[var(--ink)]">
          Workspace colours
        </h2>
        <p className="text-[11px] text-[var(--ink-muted)]">
          What everyone sees, in the mode they choose. Empty keeps the built-in colour.
        </p>
      </header>

      <div className="space-y-1" data-testid="workspace-theme-roles">
        <div className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2 px-1 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
          <span>Role</span>
          <span>Light</span>
          <span>Dark</span>
        </div>
        {styleColourRoles.map((role) => {
          const light = themeColours(theme, "light")[role] ?? "";
          const dark = themeColours(theme, "dark")[role] ?? "";
          return (
            <div
              key={role}
              className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
              data-testid={`workspace-theme-row-${role}`}
            >
              <span className="flex items-center gap-1.5 text-[12px] text-[var(--ink)]">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 shrink-0 rounded-full border border-[var(--hairline)]"
                  style={{ background: light || "var(--surface)" }}
                />
                {role}
              </span>
              {(["light", "dark"] as const).map((mode) => (
                <input
                  key={mode}
                  type="text"
                  spellCheck={false}
                  disabled={!canEdit}
                  aria-label={`${role}, ${mode}`}
                  data-testid={`workspace-theme-${mode}-${role}`}
                  value={mode === "light" ? light : dark}
                  placeholder="built-in"
                  className="w-full rounded border border-[var(--hairline)] bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
                  onChange={(event) => write(mode, role, event.target.value)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {canEdit && theme ? (
        <button
          type="button"
          className="style-chip mt-3"
          data-testid="workspace-theme-clear"
          onClick={() => workspace.setWorkspaceTheme(null)}
        >
          Back to the built-in colours
        </button>
      ) : null}
    </section>
  );
}
