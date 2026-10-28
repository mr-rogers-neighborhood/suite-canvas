import { useEffect, useMemo, useRef, useState } from "react";
import { useEscapeLayer } from "../shell/escapeLayers";
import { IconGlyph } from "./IconGlyph";
import { bundledPrefixes, useIconSet } from "./iconSets";

/** How many matches a picker shows before it asks for a narrower word. */
const VISIBLE_LIMIT = 120;

export interface IconPickerProps {
  /** The current reference, so the picker can mark it. */
  value?: string | null | undefined;
  onPick: (icon: string | null) => void;
  onClose: () => void;
  /** Keep the popover inside its anchor; a dialog passes false. */
  inline?: boolean;
}

/**
 * Choosing an icon.
 *
 * Search over the bundled sets, because a grid of two thousand cannot be
 * browsed by eye. The footer is the one door to everything else: "Add more icon
 * sets" explains where another set comes from rather than pretending the
 * bundled ones are all there is — a full catalogue browser is its own surface,
 * and this popover is not it.
 */
export function IconPicker({ value, onPick, onClose, inline = true }: IconPickerProps) {
  const [prefix, setPrefix] = useState(
    () => value?.split(":")[0] ?? bundledPrefixes[0] ?? "lucide",
  );
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(onClose);

  const names = useIconSet(prefix);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return names.slice(0, VISIBLE_LIMIT);
    return names.filter((name) => name.includes(needle)).slice(0, VISIBLE_LIMIT);
  }, [names, query]);

  useEffect(() => {
    if (!inline) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [inline, onClose]);

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Choose an icon"
      data-testid="icon-picker"
      className="w-[268px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-2 text-[12px] shadow-xl"
    >
      <div className="flex items-center gap-1.5">
        <input
          // biome-ignore lint/a11y/noAutofocus: the picker exists to be typed into
          autoFocus
          type="search"
          value={query}
          aria-label="Search icons"
          placeholder="Search icons"
          data-testid="icon-search"
          className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 outline-none focus:border-[var(--ink-muted)]"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const first = matches[0];
            if (first) onPick(`${prefix}:${first}`);
          }}
        />
        <select
          aria-label="Icon set"
          data-testid="icon-set"
          value={prefix}
          className="rounded-md border border-[var(--hairline)] bg-transparent px-1 py-1"
          onChange={(event) => setPrefix(event.target.value)}
        >
          {bundledPrefixes.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-1.5 grid max-h-[180px] grid-cols-8 gap-0.5 overflow-y-auto">
        {matches.map((name) => {
          const ref = `${prefix}:${name}`;
          const chosen = value === ref;
          return (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={name}
              aria-pressed={chosen}
              data-testid={`icon-option-${name}`}
              data-checked={chosen ? "true" : undefined}
              className={`flex h-7 items-center justify-center rounded ${
                chosen
                  ? "bg-[var(--segmented-bg)] ring-1 ring-[var(--accent)]"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
              onClick={() => onPick(ref)}
            >
              <IconGlyph icon={ref} size={15} />
            </button>
          );
        })}
        {matches.length === 0 ? (
          <p className="col-span-8 py-3 text-center text-[11px] text-[var(--ink-muted)]">
            {names.length === 0 ? "Loading icons…" : "No icon by that name."}
          </p>
        ) : null}
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-[var(--hairline)] pt-1.5">
        <button
          type="button"
          data-testid="icon-clear"
          className="rounded px-1 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => onPick(null)}
        >
          No icon
        </button>
        <button
          type="button"
          data-testid="icon-add-sets"
          className="rounded px-1 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => setAdded(true)}
        >
          Add more icon sets…
        </button>
      </div>

      {added ? (
        <p
          data-testid="icon-add-sets-note"
          className="mt-1 rounded-md bg-[var(--segmented-bg)] px-2 py-1.5 text-[11px] leading-4 text-[var(--ink-muted)]"
        >
          Every icon here is bundled with the app, so a board draws offline. Further sets are
          fetched from Iconify by this browser and kept on this device — nothing is sent to Suite.
        </p>
      ) : null}
    </div>
  );
}
