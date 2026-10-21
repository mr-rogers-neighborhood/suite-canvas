import type { NodeKind } from "@suite/graph";
import { CARD_TYPES } from "../cards/cardTypes";

export interface DockProps {
  inboxCount: number;
  libraryOpen: boolean;
  onToggleLibrary: () => void;
  onCreateCard: (kind: NodeKind) => void;
}

/**
 * Mac-style pill at the bottom of the canvas: the library on the left, card
 * types on the right. Everything floats above the board and stays out of the
 * way of canvas gestures thanks to `pointer-events` on the container only.
 */
export function Dock({ inboxCount, libraryOpen, onToggleLibrary, onCreateCard }: DockProps) {
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

      {CARD_TYPES.map((type) => (
        <button
          key={type.kind}
          type="button"
          data-testid={`dock-type-${type.kind}`}
          className="dock-button"
          onClick={() => onCreateCard(type.kind)}
        >
          <span aria-hidden="true" className="text-[13px] leading-none">
            {type.glyph}
          </span>
          <span>{type.label}</span>
        </button>
      ))}
    </div>
  );
}
