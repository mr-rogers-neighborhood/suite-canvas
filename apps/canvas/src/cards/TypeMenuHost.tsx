import { typePluralName } from "@suite/graph";
import { createPortal } from "react-dom";
import { focusFirstMenuItem, menuKeyDown } from "../dialogs/menuKeys";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * What a card's type glyph opens: the workspace's types, and the way to manage
 * them.
 *
 * The glyph is the one place a card already names its type, so it is where
 * changing the type belongs — the same list the add-card menu shows, read from
 * the same record, so the two cannot drift.
 */
export function TypeMenuHost() {
  const menu = useUiStore((state) => state.typeMenu);
  const close = useUiStore((state) => state.closeTypeMenu);
  const openTypeSettings = useUiStore((state) => state.openTypeSettings);
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const card = menu === null ? undefined : workspace.getCard(menu.cardId);
  useEscapeLayer(close, menu !== null);

  if (menu === null || card === undefined) return null;
  const anchor = menu.anchor;
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onPointerDown={close} aria-hidden="true" />
      <div
        role="menu"
        aria-label={`Type of this card`}
        data-testid="card-type-menu"
        ref={focusFirstMenuItem}
        onKeyDown={menuKeyDown}
        style={{ left: anchor.left, top: anchor.bottom + 4 }}
        className="fixed z-50 max-h-[60vh] w-52 overflow-y-auto rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 text-[12px] shadow-xl"
      >
        {snapshot.types.map((type) => (
          <button
            key={type.id}
            type="button"
            role="menuitem"
            data-testid={`card-type-option-${type.id}`}
            aria-current={card.primaryTypeId === type.id ? "true" : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10 ${
              card.primaryTypeId === type.id ? "font-medium text-[var(--ink)]" : ""
            }`}
            onClick={() => {
              workspace.setCardTypes(card.id, [type.id], type.id);
              close();
            }}
          >
            <span aria-hidden="true" className="w-4 shrink-0 text-center">
              {type.glyph}
            </span>
            <span className="min-w-0 flex-1 truncate">{typePluralName(type)}</span>
          </button>
        ))}
        {canManageSchema ? (
          <>
            <hr className="my-1 border-[var(--hairline)]" />
            <button
              type="button"
              role="menuitem"
              data-testid="card-type-manage"
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                close();
                openTypeSettings();
              }}
            >
              Manage types…
            </button>
          </>
        ) : null}
      </div>
    </>,
    document.body,
  );
}
