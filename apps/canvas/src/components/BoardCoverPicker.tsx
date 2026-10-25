import type { CardAttachment } from "@suite/graph";
import { useAttachmentSource, useCoverCandidates } from "./useBoardCover";

export interface BoardCoverPickerProps {
  /** The board whose cover is being chosen. */
  boardId: string;
  /** The attachment it currently points at, if any. */
  coverId?: string | undefined;
  onPick: (attachmentId: string | null) => void;
  disabled?: boolean;
}

/**
 * The cover of a board: an image that stands in for the live miniature inside a
 * portal card.
 *
 * The candidates are the workspace's own image attachments — the ones already in
 * somebody's card body — because that is the only inventory that exists: bytes
 * live beside the document and a card body is what references them. Nothing here
 * writes; the caller decides what the new cover is.
 */
export function BoardCoverPicker({
  boardId,
  coverId,
  onPick,
  disabled = false,
}: BoardCoverPickerProps) {
  const candidates = useCoverCandidates();
  const current = useAttachmentSource(coverId);

  return (
    <section className="mt-3" data-testid="board-cover-picker" data-board-id={boardId}>
      <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">Cover</h3>
      <div className="mt-1 flex items-start gap-2">
        <div
          className="board-cover-thumb"
          data-testid="board-cover-current"
          data-empty={current ? undefined : "true"}
        >
          {current ? (
            <img src={current} alt="" className="h-full w-full object-cover" />
          ) : (
            <span aria-hidden="true">{"\u25a6"}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-[var(--ink-muted)]">
            {coverId
              ? "A portal shows this instead of the live picture."
              : "A portal shows the live picture."}
          </p>
          <button
            type="button"
            className="library-action mt-1"
            data-testid="board-cover-clear"
            disabled={disabled || !coverId}
            onClick={() => onPick(null)}
          >
            Use the live picture
          </button>
        </div>
      </div>

      {candidates.length === 0 ? (
        <p className="mt-1 text-[11px] text-[var(--ink-muted)]" data-testid="board-cover-empty">
          Paste an image into any card and it becomes available here.
        </p>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-1" data-testid="board-cover-options">
          {candidates.map((candidate: CardAttachment) => (
            <li key={candidate.id}>
              <button
                type="button"
                className="library-action"
                aria-pressed={candidate.id === coverId}
                disabled={disabled}
                data-testid={`board-cover-option-${candidate.id}`}
                title={candidate.name ?? "Image"}
                onClick={() => onPick(candidate.id)}
              >
                {candidate.name ?? "Image"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
