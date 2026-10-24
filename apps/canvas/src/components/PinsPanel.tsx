import type { Pin, WorkspaceDocument } from "@suite/graph";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useUiStore } from "../store/useUiStore";

/**
 * Pins live in their own root map, outside the snapshot sections a board or card
 * write touch, so the panel subscribes to that map alone — the same shape as
 * `useSavedViews`.
 */
export function usePins(workspace: WorkspaceDocument | null | undefined): Pin[] {
  const subscribe = useCallback(
    (onChange: () => void) => (workspace ? workspace.observePins(onChange) : () => {}),
    [workspace],
  );
  const getSnapshot = useCallback(() => workspace?.pinsRevision ?? 0, [workspace]);
  const revision = useSyncExternalStore(subscribe, getSnapshot);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the revision is the invalidation signal.
  return useMemo(() => (workspace ? workspace.listPins() : []), [workspace, revision]);
}

/** One board's pins, in the document's creation order. */
export interface PinGroup {
  readonly boardId: string;
  readonly boardName: string;
  readonly pins: Pin[];
}

/**
 * Groups pins by board with the active board first, then every other board in
 * the order the workspace lists them. Pins on a board that is not in the
 * workspace are skipped, the same rule `listPins` applies to a corrupt record:
 * a marker with no board has nowhere to render.
 */
export function groupPinsByBoard(
  pins: readonly Pin[],
  boardNames: ReadonlyMap<string, string>,
  activeBoardId: string | null,
): PinGroup[] {
  const byBoard = new Map<string, Pin[]>();
  for (const pin of pins) {
    if (!boardNames.has(pin.boardId)) continue;
    const list = byBoard.get(pin.boardId);
    if (list === undefined) byBoard.set(pin.boardId, [pin]);
    else list.push(pin);
  }
  const groups: PinGroup[] = [];
  for (const [boardId, list] of byBoard) {
    groups.push({ boardId, boardName: boardNames.get(boardId) ?? boardId, pins: list });
  }
  const active = groups.findIndex((group) => group.boardId === activeBoardId);
  if (active > 0) {
    const [first] = groups.splice(active, 1);
    if (first !== undefined) groups.unshift(first);
  }
  return groups;
}

export interface PinsPanelProps {
  /** The live document; `null` while it opens, which renders the empty state. */
  workspace: WorkspaceDocument | null;
  /** The board the canvas is on; its pins are listed first. */
  activeBoardId: string | null;
  /** Clicking a row is a navigation action, never a write. */
  onFocusPin: (pin: Pin) => void;
  /**
   * Renaming and deleting a pin is workspace configuration, so it is gated by
   * `canManageSchema` by default; tests and stories may override.
   */
  canManage?: boolean;
}

/**
 * The library's Pins list: every pin in the workspace, grouped by board, with
 * an inline rename and an inline delete confirm. It reads the `pins` map and
 * writes only through `WorkspaceDocument`, so a viewer's copy is read-only and
 * a collaborator's copy repaints on the map's own revision.
 */
export function PinsPanel({ workspace, activeBoardId, onFocusPin, canManage }: PinsPanelProps) {
  const pins = usePins(workspace);
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  const manage = canManage ?? canManageSchema;

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // `blur` follows Escape on some browsers; the ref makes the cancel win.
  const cancelled = useRef<string | null>(null);

  const boardNames = new Map((workspace?.listViews() ?? []).map((board) => [board.id, board.name]));
  const groups = groupPinsByBoard(pins, boardNames, activeBoardId);

  const startRename = (pin: Pin) => {
    cancelled.current = null;
    setRenamingId(pin.id);
    setDraft(pin.label);
    setConfirmId(null);
  };

  const commitRename = (pin: Pin) => {
    if (cancelled.current === pin.id) {
      cancelled.current = null;
      setRenamingId(null);
      return;
    }
    setRenamingId(null);
    const label = draft.trim();
    if (label.length === 0 || label === pin.label) return;
    workspace?.updatePin(pin.id, { label });
  };

  const cancelRename = (pin: Pin) => {
    cancelled.current = pin.id;
    setRenamingId(null);
  };

  if (groups.length === 0) {
    return (
      <section className="pins-panel" data-testid="pins-panel" aria-label="Pins">
        <p
          className="px-2 py-6 text-center text-[12px] text-[var(--ink-muted)]"
          data-testid="pins-empty"
        >
          No pins yet. Drop one on the canvas to mark a place.
        </p>
      </section>
    );
  }

  return (
    <section className="pins-panel" data-testid="pins-panel" aria-label="Pins">
      <div className="space-y-2">
        {groups.map((group) => (
          <section
            key={group.boardId}
            data-testid={`pins-group-${group.boardId}`}
            data-active={group.boardId === activeBoardId ? "true" : undefined}
          >
            <h3 className="library-group-heading px-2">
              <span className="min-w-0 truncate">{group.boardName}</span>
              <span className="tabular-nums text-[var(--ink-muted)]">{group.pins.length}</span>
            </h3>
            <ul className="space-y-0.5">
              {group.pins.map((pin) => (
                <li key={pin.id} className="library-entry" data-testid={`pin-row-${pin.id}`}>
                  {renamingId === pin.id ? (
                    <div className="flex items-center gap-1 px-2 py-1">
                      <input
                        // biome-ignore lint/a11y/noAutofocus: inline rename is an explicit gesture
                        autoFocus
                        value={draft}
                        aria-label={`Rename ${pin.label}`}
                        data-testid={`pin-rename-input-${pin.id}`}
                        className="min-w-0 flex-1 rounded px-1.5 py-1 text-[12px] outline-none ring-1 ring-blue-400"
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commitRename(pin)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRename(pin);
                          }
                        }}
                      />
                    </div>
                  ) : confirmId === pin.id ? (
                    <div className="flex items-center gap-1 px-2 py-1 text-[12px]">
                      <span className="min-w-0 flex-1 truncate">Delete “{pin.label}”?</span>
                      <button
                        type="button"
                        data-testid={`pin-delete-confirm-${pin.id}`}
                        className="library-action text-red-600"
                        onClick={() => {
                          workspace?.deletePin(pin.id);
                          setConfirmId(null);
                        }}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        data-testid={`pin-delete-cancel-${pin.id}`}
                        className="library-action"
                        onClick={() => setConfirmId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10">
                      <button
                        type="button"
                        data-testid={`pin-focus-${pin.id}`}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12px]"
                        title={`Focus ${pin.label}`}
                        onClick={() => onFocusPin(pin)}
                      >
                        <span
                          aria-hidden="true"
                          data-testid={`pin-swatch-${pin.id}`}
                          data-color={pin.color}
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: `var(--section-${pin.color})` }}
                        />
                        <span className="min-w-0 truncate">{pin.label}</span>
                        {pin.target ? (
                          <span
                            data-testid={`pin-target-${pin.id}`}
                            className="shrink-0 text-[10px] uppercase tracking-[0.04em] text-[var(--ink-muted)]"
                          >
                            {pin.target.kind}
                          </span>
                        ) : null}
                      </button>
                      {manage ? (
                        <>
                          <button
                            type="button"
                            aria-label={`Rename ${pin.label}`}
                            data-testid={`pin-rename-${pin.id}`}
                            className="library-action"
                            onClick={() => startRename(pin)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${pin.label}`}
                            data-testid={`pin-delete-${pin.id}`}
                            className="library-action"
                            onClick={() => {
                              setConfirmId(pin.id);
                              setRenamingId(null);
                            }}
                          >
                            {"\u00d7"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
