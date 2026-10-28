import { useEffect, useRef } from "react";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { openSettings } from "../styles/settingsEvents";
import { StyleTab } from "../styles/surface/StyleTab";

/**
 * The appearance panel, opened from a right-click or from a selection.
 *
 * It is the inspector's Style tab, mounted where the reader is looking. The point
 * is that "change how this looks" is one gesture from the board: the menu's own
 * colour row handles the common case, and this holds everything else — shape, ink,
 * radius, opacity, text scale, the four per-side edges, and the control that makes
 * the result the default for the card's type.
 *
 * One panel for one card or for thirty. Right-clicking a card inside a selection
 * edits the whole selection, so a multi-select costs a right-click rather than a
 * panel appearing on its own the moment a second card is picked.
 */
export function AppearanceHost() {
  const target = useUiStore((state) => state.appearanceTarget);
  const close = useUiStore((state) => state.closeAppearance);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const snapshot = useWorkspaceSnapshot();
  const panel = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(close, target !== null);

  useEffect(() => {
    if (target === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      // A press on the board is how a reader gets on with their work; the panel
      // is not a modal and must not eat the gesture.
      close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [target, close]);

  if (target === null) return null;

  const ids = target.ids.length > 0 ? target.ids : [target.id];
  const typeName =
    target.kind === "card" && ids.length === 1
      ? (() => {
          const card = snapshot.cards.find((entry) => entry.id === ids[0]);
          const type = snapshot.types.find((entry) => entry.id === card?.primaryTypeId);
          return type?.name ?? null;
        })()
      : null;

  // Kept on screen: a right-click near the bottom-right corner would otherwise
  // open a panel halfway off the window.
  const left = Math.min(target.at.x, Math.max(8, window.innerWidth - 288));
  const top = Math.min(target.at.y, Math.max(8, window.innerHeight - 380));

  return (
    <div
      ref={panel}
      data-testid="appearance-panel"
      role="dialog"
      aria-label="Appearance"
      className="fixed z-50 max-h-[60vh] w-[268px] overflow-auto rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-2.5 shadow-xl"
      style={{ left, top }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[12px] font-semibold text-[var(--ink)]">
          {ids.length > 1 ? `Appearance \u00b7 ${ids.length} cards` : "Appearance"}
        </h2>
        <button
          type="button"
          data-testid="appearance-close"
          aria-label="Close appearance"
          className="rounded px-1.5 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={close}
        >
          {"\u00d7"}
        </button>
      </div>
      <StyleTab
        targets={ids.map((id) => ({ kind: target.kind, id }))}
        canEdit={canEditLayout}
        typeName={typeName}
      />
      {/*
        A colour the palette does not have is the one thing this panel cannot
        change itself, so it says where the palette lives rather than leaving the
        reader to find Settings.
      */}
      <button
        type="button"
        data-testid="appearance-edit-palette"
        className="mt-2 w-full rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => {
          close();
          openSettings();
        }}
      >
        Edit palette\u2026
      </button>
    </div>
  );
}
