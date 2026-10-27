import {
  contrastRatio,
  DEFAULT_PALETTE,
  type PaletteSwatch,
  pickInk,
  type StyleColourRole,
  type WorkspaceDocument,
} from "@suite/graph";
import { useWorkspacePalette } from "../app/workspacePaint";
import { useSurfacePaint } from "../canvas/surfaceContext";

/**
 * The workspace palette: the colours a card, a link or a type can wear.
 *
 * Every swatch carries an ink for each mode, chosen here and stored with the
 * colour. A reader therefore cannot make a card whose text they cannot read: the
 * ink is measured against the colour they picked, not against a role the theme
 * happens to resolve elsewhere.
 *
 * Both modes sit side by side because a workspace has to look like itself at both
 * brightnesses, and a colour defined in light and undefined in dark is a gap
 * nobody notices until they open the app at night.
 */
export function PaletteEditor({ workspace }: { workspace: WorkspaceDocument }) {
  const palette = useWorkspacePalette(workspace);
  const { roles } = useSurfacePaint();

  const write = (next: readonly PaletteSwatch[]) => workspace.setPalette(next);

  const change = (id: string, patch: Partial<PaletteSwatch>) =>
    write(palette.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));

  /** A colour and its ink move together, so the pair is never briefly unreadable. */
  const setColour = (swatch: PaletteSwatch, mode: "light" | "dark", colour: string) => {
    const ink: StyleColourRole = pickInk(colour, roles)?.ink ?? "ink";
    change(
      swatch.id,
      mode === "dark" ? { dark: colour, inkDark: ink } : { light: colour, inkLight: ink },
    );
  };

  const move = (index: number, delta: number) => {
    const next = [...palette];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(Math.min(Math.max(index + delta, 0), next.length), 0, moved);
    write(next);
  };

  const remove = (id: string) => write(palette.filter((entry) => entry.id !== id));

  const add = () => {
    const light = "#94a3b8";
    const dark = "#cbd5e1";
    write([
      ...palette,
      {
        id: `swatch-${crypto.randomUUID().slice(0, 8)}`,
        name: "New colour",
        light,
        dark,
        inkLight: pickInk(light, roles)?.ink ?? "ink",
        inkDark: pickInk(dark, roles)?.ink ?? "ink",
      },
    ]);
  };

  return (
    <div data-testid="palette-editor">
      <h4 className="mt-3 text-[12px] font-semibold">Palette</h4>

      <ul className="mt-2 space-y-2">
        {palette.map((swatch, index) => (
          <li key={swatch.id} className="rounded-lg border border-[var(--hairline)] p-2">
            <div className="flex items-center gap-1.5">
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
            </div>

            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <ModeRow
                mode="light"
                swatch={swatch}
                roles={roles}
                onColour={(colour) => setColour(swatch, "light", colour)}
              />
              <ModeRow
                mode="dark"
                swatch={swatch}
                roles={roles}
                onColour={(colour) => setColour(swatch, "dark", colour)}
              />
            </div>
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

/** One mode's colour: a native picker, an editable hex, and the ink it will carry. */
function ModeRow({
  mode,
  swatch,
  roles,
  onColour,
}: {
  mode: "light" | "dark";
  swatch: PaletteSwatch;
  roles: Partial<Record<StyleColourRole, string>>;
  onColour: (colour: string) => void;
}) {
  const colour = mode === "dark" ? swatch.dark : swatch.light;
  const ink = mode === "dark" ? swatch.inkDark : swatch.inkLight;
  const ratio = roles[ink] ? contrastRatio(colour, roles[ink] ?? "") : null;
  const readable = ratio !== null && ratio >= 3;

  return (
    <div data-testid={`palette-${mode}-${swatch.id}`}>
      <span className="text-[10px] text-[var(--ink-muted)]">
        {mode === "dark" ? "Dark" : "Light"}
      </span>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="color"
          aria-label={`${swatch.name} in ${mode} mode`}
          data-testid={`palette-picker-${mode}-${swatch.id}`}
          value={/^#[0-9a-f]{6}$/i.test(colour) ? colour : "#000000"}
          className="h-6 w-6 shrink-0 rounded border border-[var(--hairline)] bg-transparent p-0"
          onChange={(event) => onColour(event.target.value)}
        />
        <input
          aria-label={`${swatch.name} ${mode} hex`}
          data-testid={`palette-hex-${mode}-${swatch.id}`}
          value={colour}
          className="min-w-0 flex-1 rounded border border-[var(--hairline)] bg-transparent px-1 py-0.5 font-mono text-[10px]"
          onChange={(event) => onColour(event.target.value)}
        />
      </div>
      <p
        data-testid={`palette-ink-${mode}-${swatch.id}`}
        data-readable={readable ? "true" : "false"}
        className="mt-0.5 text-[10px] leading-3 text-[var(--ink-muted)]"
      >
        {ratio === null ? `${ink} ink` : `${ink} ink \u00b7 ${ratio.toFixed(1)}:1`}
      </p>
    </div>
  );
}
