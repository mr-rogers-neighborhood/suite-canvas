import type { Card, CardType } from "@suite/graph";
import { useEffect, useRef, useState } from "react";

/**
 * The multi-type picker (ADR-0053).
 * The primary chip is the card's presentation — glyph, colour, renderer — and is
 * only ever replaced through its own menu; the other members are chips that add
 * fields and can be dropped without losing their values. Nothing here reads the
 * *set* of types to decide behaviour, which is the rule that keeps this linear.
 */
export function CardTypePicker({
  card,
  types,
  orderedIds,
  onSetPrimary,
  onAdd,
  onRemove,
  onManage,
}: {
  card: Card;
  types: readonly CardType[];
  /** The card's types, primary first. */
  orderedIds: readonly string[];
  onSetPrimary: (typeId: string) => void;
  onAdd: ((typeId: string) => void) | undefined;
  onRemove: ((typeId: string) => void) | undefined;
  onManage: () => void;
}) {
  const [menu, setMenu] = useState<"primary" | "add" | null>(null);
  const container = useRef<HTMLDivElement | null>(null);

  // Both menus are one disclosure: a pointer anywhere else, or Escape, closes
  // whichever is open, so the row never leaves a floating list behind.
  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: PointerEvent) => {
      if (container.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const byId = new Map(types.map((type) => [type.id, type]));
  const primaryId = card.primaryTypeId ?? orderedIds[0];
  const primary = primaryId ? byId.get(primaryId) : undefined;
  const added = orderedIds
    .filter((id) => id !== primaryId)
    .map((id) => byId.get(id))
    .filter((type): type is CardType => type !== undefined);
  const addable = onAdd ? types.filter((type) => !orderedIds.includes(type.id)) : [];
  const others = primary ? types.filter((type) => type.id !== primary.id) : types;

  const chipClass =
    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors";
  const menuClass =
    "absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl";
  const menuItemClass =
    "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10";

  return (
    <div className="space-y-1.5" ref={container}>
      <div className="flex flex-wrap items-center gap-1" data-testid="type-picker">
        {primary ? (
          <span className="relative inline-flex" data-testid="type-primary-chip">
            <span
              data-testid={`type-primary-${primary.id}`}
              data-primary="true"
              title="Primary type — this is what the card looks like"
              className="flex items-center gap-1 rounded-full border border-transparent bg-[var(--segmented-bg)] py-0.5 pl-2 pr-1 text-[11px] font-medium text-[var(--ink)]"
            >
              <span aria-hidden="true">{primary.glyph}</span>
              {primary.name}
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menu === "primary"}
                aria-label={`Change primary type (${primary.name})`}
                data-testid="type-primary-menu"
                className="rounded-full px-1 leading-none text-[var(--ink-muted)] hover:bg-black/10 dark:hover:bg-white/10"
                onClick={() => setMenu(menu === "primary" ? null : "primary")}
              >
                {"\u25be"}
              </button>
            </span>
            {menu === "primary" ? (
              <div
                role="menu"
                aria-label="Primary type"
                data-testid="type-primary-options"
                className={menuClass}
              >
                {others.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-[var(--ink-muted)]">
                    No other type yet.
                  </p>
                ) : (
                  others.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      role="menuitem"
                      data-testid={`type-primary-option-${type.id}`}
                      className={menuItemClass}
                      onClick={() => {
                        setMenu(null);
                        onSetPrimary(type.id);
                      }}
                    >
                      <span aria-hidden="true">{type.glyph}</span>
                      {type.name}
                      {orderedIds.includes(type.id) ? null : (
                        <span className="ml-auto text-[10px] text-[var(--ink-muted)]">adds</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </span>
        ) : null}

        {added.map((type) => (
          <span
            key={type.id}
            data-testid={`type-chip-${type.id}`}
            className={`${chipClass} border-dashed border-[var(--hairline)] text-[var(--ink)]`}
          >
            <span aria-hidden="true" className="text-[var(--ink-muted)]">
              {type.glyph}
            </span>
            {type.name}
            {onRemove ? (
              <button
                type="button"
                aria-label={`Remove type ${type.name}`}
                data-testid={`type-remove-${type.id}`}
                className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
                onClick={() => onRemove(type.id)}
              >
                {"\u00d7"}
              </button>
            ) : null}
          </span>
        ))}

        {addable.length > 0 ? (
          <span className="relative inline-flex">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menu === "add"}
              aria-label="Add another type"
              data-testid="type-add"
              className={`${chipClass} border-dashed border-[var(--hairline)] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10`}
              onClick={() => setMenu(menu === "add" ? null : "add")}
            >
              + Type
            </button>
            {menu === "add" ? (
              <div
                role="menu"
                aria-label="Add a type"
                data-testid="type-add-menu"
                className={menuClass}
              >
                {addable.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    role="menuitem"
                    data-testid={`type-option-${type.id}`}
                    className={menuItemClass}
                    onClick={() => {
                      setMenu(null);
                      onAdd?.(type.id);
                    }}
                  >
                    <span aria-hidden="true">{type.glyph}</span>
                    {type.name}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        ) : null}

        <button
          type="button"
          data-testid="manage-types"
          className="rounded-full px-2 py-0.5 text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline"
          onClick={onManage}
        >
          Manage
        </button>
      </div>
    </div>
  );
}
