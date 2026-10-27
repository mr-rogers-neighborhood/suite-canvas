import { DEFAULT_PALETTE, type PaletteSwatch, type WorkspaceDocument } from "@suite/graph";
import { useWorkspacePalette } from "../app/workspacePaint";

/**
 * The workspace palette: the colours a card, a link or a type can wear.
 *
 * One list, in the order the swatches appear in every menu. Each row carries both
 * modes together, because a workspace has to look like itself at both
 * brightnesses, and a colour defined in light and undefined in dark is a gap
 * nobody notices until somebody opens the app at night.
 *
 * The values are typed rather than picked. The vocabulary already allows
 * `rgba(...)` and `color-mix(...)`, and a colour picker would refuse half of what
 * a token can hold.
 */
export function PaletteEditor({ workspace }: { workspace: WorkspaceDocument }) {
  const palette = useWorkspacePalette(workspace);

  const write = (next: readonly PaletteSwatch[]) => workspace.setPalette(next);

  const change = (id: string, patch: Partial<PaletteSwatch>) =>
    write(palette.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  const move = (index: number, delta: number) => {
    const next = [...palette];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(Math.min(Math.max(index + delta, 0), next.length), 0, moved);
    write(next);
  };

  const remove = (id: string) => write(palette.filter((entry) => entry.id !== id));

  const add = () =>
    write([
      ...palette,
      {
        id: `swatch-${crypto.randomUUID().slice(0, 8)}`,
        name: "New colour",
        light: "#94a3b8",
        dark: "#cbd5e1",
      },
    ]);

  return (
    <div data-testid="palette-editor">
      <h4 className="mt-3 text-[12px] font-semibold">Palette</h4>
      <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">
        These are the colours every card, link and type can wear. Each has a value for light and for
        dark.
      </p>

      <ul className="mt-2 space-y-1">
        {palette.map((swatch, index) => (
          <li key={swatch.id} className="flex items-center gap-1.5" data-testid="palette-row">
            <input
              aria-label={`${swatch.name} in light mode`}
              data-testid={`palette-light-${swatch.id}`}
              value={swatch.light}
              className="appearance-dialog__value w-24 rounded border border-[var(--hairline)] bg-transparent px-1 py-0.5 font-mono text-[10px]"
              onChange={(event) => change(swatch.id, { light: event.target.value })}
            />
            <input
              aria-label={`${swatch.name} in dark mode`}
              data-testid={`palette-dark-${swatch.id}`}
              value={swatch.dark}
              className="appearance-dialog__value w-24 rounded border border-[var(--hairline)] bg-transparent px-1 py-0.5 font-mono text-[10px]"
              onChange={(event) => change(swatch.id, { dark: event.target.value })}
            />
            <input
              aria-label={`${swatch.name} name`}
              data-testid={`palette-name-${swatch.id}`}
              value={swatch.name}
              className="min-w-0 flex-1 rounded border border-[var(--hairline)] bg-transparent px-1 py-0.5 text-[11px]"
              onChange={(event) => change(swatch.id, { name: event.target.value })}
            />
            <button
              type="button"
              aria-label={`Move ${swatch.name} up`}
              data-testid={`palette-up-${swatch.id}`}
              disabled={index === 0}
              className="appearance-dialog__value px-1 text-[11px] disabled:opacity-40"
              onClick={() => move(index, -1)}
            >
              {"\u2191"}
            </button>
            <button
              type="button"
              aria-label={`Move ${swatch.name} down`}
              data-testid={`palette-down-${swatch.id}`}
              disabled={index === palette.length - 1}
              className="appearance-dialog__value px-1 text-[11px] disabled:opacity-40"
              onClick={() => move(index, 1)}
            >
              {"\u2193"}
            </button>
            <button
              type="button"
              aria-label={`Remove ${swatch.name}`}
              data-testid={`palette-remove-${swatch.id}`}
              className="appearance-dialog__value px-1 text-[11px]"
              onClick={() => remove(swatch.id)}
            >
              {"\u00d7"}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          data-testid="palette-add"
          className="appearance-dialog__value rounded border border-[var(--hairline)] px-2 py-0.5 text-[11px]"
          onClick={add}
        >
          Add a colour
        </button>
        <button
          type="button"
          data-testid="palette-reset"
          className="appearance-dialog__value rounded border border-[var(--hairline)] px-2 py-0.5 text-[11px]"
          onClick={() => workspace.setPalette(DEFAULT_PALETTE)}
        >
          Restore the defaults
        </button>
      </div>
    </div>
  );
}
