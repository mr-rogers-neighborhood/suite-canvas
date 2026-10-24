/**
 * Renaming a Board where its name already is.
 *
 * The face layer draws a Board's name as a screen-space pill (`suiteBoardFace`)
 * because a name has to be readable at every zoom. So renaming belongs there
 * too: one field laid over that pill, prefilled with the current name, and one
 * `renameBoard` write when the reader commits. A dialog would be a second
 * surface saying the same thing about the same object.
 *
 * The pill is found by the `data-suite-board-id` the face layer stamps on it. If
 * the Board's face is hidden (a mat below the band where a name can be read) or
 * the layer has not painted yet, the field falls back to the point the menu was
 * opened at — the reader asked from there, so that is where the answer belongs.
 *
 * Commit rules are the edge-description editor's, because it is the same job:
 * Enter and a changed blur commit, Escape and an unchanged blur cancel, and a
 * commit happens once (`settled`).
 */

import { useEffect, useRef, useState } from "react";

export interface BoardRenameInputProps {
  /** The Board's canonical id; also the face layer's pill key. */
  readonly boardId: string;
  /** The name the pill currently prints. */
  readonly name: string;
  /** Where to stand when the pill cannot be measured (client px). */
  readonly fallback: { readonly x: number; readonly y: number };
  readonly onCommit: (name: string) => void;
  readonly onCancel: () => void;
}

/** The attribute the face layer stamps on a Board's name pill. */
export const BOARD_NAME_PILL_ATTRIBUTE = "data-suite-board-id";

/** Where a Board's name pill is on screen, or null when it is not drawn. */
export function boardNamePillRect(
  boardId: string,
  ownerDocument: Document | null | undefined,
): { left: number; top: number; width: number; height: number } | null {
  if (ownerDocument === null || ownerDocument === undefined) return null;
  // The id is a document id (letters, digits, dashes); quoted, it needs no
  // escaping, and quoting keeps an odd id from becoming a selector.
  const element = ownerDocument.querySelector<HTMLElement>(
    `[${BOARD_NAME_PILL_ATTRIBUTE}="${boardId.replace(/"/g, '\\"')}"]`,
  );
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function BoardRenameInput({
  boardId,
  name,
  fallback,
  onCommit,
  onCancel,
}: BoardRenameInputProps) {
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  // Measured once, on mount: the field replaces the reader's view of the name
  // for a moment, and re-measuring per keystroke would make it chase the camera.
  const [pill] = useState(() =>
    boardNamePillRect(boardId, typeof document === "undefined" ? null : document),
  );

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = draft.trim();
    if (commit && next.length > 0 && next !== name) onCommit(next);
    else onCancel();
  };

  const placement =
    pill === null
      ? {
          left: fallback.x,
          top: fallback.y,
          width: 220,
          transform: "translate(-50%, -50%)",
        }
      : { left: pill.left, top: pill.top, width: Math.max(160, pill.width), transform: "none" };

  return (
    <input
      ref={input}
      data-testid="board-rename-input"
      aria-label="Board name"
      placeholder="Name this board"
      value={draft}
      style={{
        position: "fixed",
        zIndex: 50,
        left: placement.left,
        top: placement.top,
        width: placement.width,
        transform: placement.transform,
        height: 22,
        padding: "0 6px",
        border: "1px solid var(--hairline)",
        borderRadius: 6,
        background: "var(--surface)",
        color: "var(--ink)",
        font: "600 12px/16px ui-sans-serif, system-ui, sans-serif",
        boxShadow: "0 10px 28px -14px rgba(0, 0, 0, 0.45)",
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          settle(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          settle(false);
        }
      }}
    />
  );
}
