import { useEffect, useRef, useState } from "react";

export interface EdgeDescriptionInputProps {
  /** Screen position of the gesture that opened the editor. */
  x: number;
  y: number;
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Inline editor for a link description, anchored where the user double-clicked.
 * Enter and a changed blur commit, Escape and an unchanged blur cancel.
 */
export function EdgeDescriptionInput({
  x,
  y,
  value,
  onCommit,
  onCancel,
}: EdgeDescriptionInputProps) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const settled = useRef(false);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit && draft !== value) onCommit(draft);
    else onCancel();
  };

  return (
    <input
      ref={input}
      className="edge-description-input"
      data-testid="edge-description-input"
      aria-label="Arrow description"
      placeholder="Describe this link…"
      value={draft}
      style={{ left: x, top: y }}
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
