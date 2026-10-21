import { useEffect } from "react";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
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
        className="fixed z-50 min-w-[160px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
        style={{ left: x, top: y }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={`block w-full rounded px-3 py-1.5 text-left text-sm ${
              item.danger ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-100"
            }`}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
