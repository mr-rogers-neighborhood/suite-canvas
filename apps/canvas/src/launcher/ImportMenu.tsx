import { useEffect } from "react";
import { focusFirstMenuItem, menuKeyDown } from "../dialogs/menuKeys";

/**
 * The three import doors a row offers, behind one button.
 *
 * They are one menu rather than three buttons because they answer one question —
 * "bring something into *this* workspace" — and only the reader's source differs: a
 * folder from a directory picker, a zip a Files app can hand over but not unpack, or
 * a `.suite` backup. Two of them set the row as the target and open a picker; a
 * backup replaces the workspace instead, which is why its press is its own callback.
 */
export function ImportMenu({
  workspaceId,
  workspaceName,
  open,
  onOpen,
  onClose,
  onImportFolder,
  onImportZip,
  onOpenBackup,
  disabled,
}: {
  workspaceId: string;
  workspaceName: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onImportFolder: () => void;
  onImportZip: () => void;
  onOpenBackup: () => void;
  disabled: boolean;
}) {
  // A press anywhere else closes it, the way a popover is expected to.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-import-menu]") !== null) return;
      onClose();
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, onClose]);

  const item =
    "block w-full rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-black/5 dark:hover:bg-white/10";

  return (
    <span className="relative" data-import-menu={workspaceId}>
      <button
        type="button"
        data-testid={`launcher-vault-${workspaceId}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Import into ${workspaceName}`}
        title="Import into this workspace…"
        className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100 focus:opacity-100 dark:hover:bg-white/10"
        onClick={onOpen}
        disabled={disabled}
      >
        Import
      </button>
      {open ? (
        <span
          role="menu"
          data-testid={`launcher-import-menu-${workspaceId}`}
          className="absolute right-0 top-full z-20 mt-1 w-[190px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 text-left shadow-lg"
          ref={focusFirstMenuItem}
          onKeyDown={(event) => {
            menuKeyDown(event);
            if (event.key !== "Escape") return;
            event.stopPropagation();
            onClose();
          }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid={`launcher-import-folder-${workspaceId}`}
            className={item}
            onClick={() => {
              onClose();
              onImportFolder();
            }}
          >
            Obsidian folder…
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid={`launcher-import-zip-${workspaceId}`}
            className={item}
            onClick={() => {
              onClose();
              onImportZip();
            }}
          >
            Obsidian .zip…
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid={`launcher-import-backup-${workspaceId}`}
            className={item}
            onClick={() => {
              onClose();
              onOpenBackup();
            }}
          >
            Open a .suite backup…
          </button>
        </span>
      ) : null}
    </span>
  );
}
