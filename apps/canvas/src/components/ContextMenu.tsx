import { useEffect, useState } from "react";

export interface ContextMenuItem {
  label: string;
  onSelect?: () => void;
  danger?: boolean;
  /** Nested menu, e.g. the "Position" submenu. */
  items?: ContextMenuItem[];
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const itemClass = (danger?: boolean) =>
  `flex w-full items-center justify-between gap-3 rounded px-3 py-1.5 text-left text-sm ${
    danger
      ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-500/15"
      : "hover:bg-black/5 dark:hover:bg-white/10"
  }`;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        aria-label="Close context menu"
        className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
        onClick={onClose}
        onContextMenu={(event) => event.preventDefault()}
      />
      <div
        data-testid="context-menu"
        role="menu"
        className="fixed z-50 min-w-[180px] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
        style={{ left: x, top: y }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((item) =>
          item.items ? (
            <div key={item.label} className="relative">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSubmenu === item.label}
                className={itemClass(item.danger)}
                onMouseEnter={() => setOpenSubmenu(item.label)}
                onFocus={() => setOpenSubmenu(item.label)}
                onClick={() => setOpenSubmenu(openSubmenu === item.label ? null : item.label)}
              >
                {item.label}
                <span aria-hidden="true" className="text-xs opacity-60">
                  {"\u25b8"}
                </span>
              </button>
              {openSubmenu === item.label ? (
                <div
                  role="menu"
                  aria-label={item.label}
                  data-testid="context-submenu"
                  className="absolute left-full top-0 ml-1 min-w-[170px] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
                >
                  {item.items.map((subItem) => (
                    <button
                      key={subItem.label}
                      type="button"
                      role="menuitem"
                      className={itemClass(subItem.danger)}
                      onClick={() => {
                        subItem.onSelect?.();
                        onClose();
                      }}
                    >
                      {subItem.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={itemClass(item.danger)}
              onClick={() => {
                item.onSelect?.();
                onClose();
              }}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </>
  );
}
