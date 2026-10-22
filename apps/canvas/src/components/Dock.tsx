import type { CardType } from "@suite/graph";
import { useEffect, useRef, useState } from "react";

export interface DockProps {
  inboxCount: number;
  libraryOpen: boolean;
  types: CardType[];
  onToggleLibrary: () => void;
  onCreateCard: (typeId: string) => void;
  onManageTypes: () => void;
  /** Types, fields and tags; hidden when the session cannot change the schema. */
  canManageSchema?: boolean;
}

/**
 * Mac-style pill at the bottom of the canvas: the library on the left, card
 * creation on the right. Everything floats above the board and stays out of the
 * way of canvas gestures thanks to `pointer-events` on the container only.
 */
export function Dock({
  inboxCount,
  libraryOpen,
  types,
  onToggleLibrary,
  onCreateCard,
  onManageTypes,
  canManageSchema = true,
}: DockProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const create = (typeId: string) => {
    setMenuOpen(false);
    onCreateCard(typeId);
  };

  return (
    <div className="dock" role="toolbar" aria-label="Card library">
      <button
        type="button"
        aria-pressed={libraryOpen}
        aria-expanded={libraryOpen}
        data-testid="dock-library"
        className="dock-button"
        onClick={onToggleLibrary}
      >
        <span aria-hidden="true" className="text-[13px] leading-none">
          {"\u25a4"}
        </span>
        <span>Library</span>
        {inboxCount > 0 ? (
          <span className="dock-badge" data-testid="dock-inbox-count">
            {inboxCount}
          </span>
        ) : null}
      </button>

      <span className="dock-separator" aria-hidden="true" />

      <div className="relative" ref={menu}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-testid="dock-new-card"
          className="dock-button"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true" className="text-[13px] leading-none">
            +
          </span>
          <span>New card</span>
        </button>

        {menuOpen ? (
          <div
            role="menu"
            data-testid="dock-type-menu"
            className="absolute bottom-full left-1/2 mb-2 w-48 -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
          >
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                role="menuitem"
                data-testid={`dock-type-${type.id}`}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => create(type.id)}
              >
                <span aria-hidden="true" className="w-4 text-center text-[var(--ink-muted)]">
                  {type.glyph}
                </span>
                <span className="min-w-0 flex-1 truncate">{type.name}</span>
              </button>
            ))}
            {canManageSchema ? (
              <>
                <div className="my-1 h-px bg-[var(--hairline)]" />
                <button
                  type="button"
                  role="menuitem"
                  data-testid="dock-manage-types"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => {
                    setMenuOpen(false);
                    onManageTypes();
                  }}
                >
                  <span aria-hidden="true" className="w-4 text-center">
                    {"\u2699"}
                  </span>
                  <span>Manage types</span>
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
