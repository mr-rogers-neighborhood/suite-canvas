import type { WorkspaceDocument } from "@suite/graph";
import { useMemo } from "react";
import { RollupSummary } from "../canvas/RollupSummary";
import { cardRollup } from "../canvas/rollup";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * The rollup rail (ADR-0060).
 *
 * A card's collapse control belongs on the card, and a section's on its header — but
 * neither surface can host one yet: the card face paints from the board projection
 * and a section cannot collapse at all, so a fold there would have nothing to fold.
 * The rail is where the collapse is visible today: one card reduced to its header
 * line, the count it hides, and the rows that prove the count, all read through
 * `cardRollup` so the header and the list cannot disagree.
 *
 * The card it reads is the one in front of the reader — the focus surface's card,
 * else the inspector's, else the selection — and a row opens that member, which is
 * the way back the record asks for.
 */
export interface RollupSummaryHostProps {
  workspace: WorkspaceDocument;
}

export function RollupSummaryHost({ workspace }: RollupSummaryHostProps) {
  const rollupOpen = useUiStore((state) => state.rollupOpen);
  const toggleRollup = useUiStore((state) => state.toggleRollup);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const cardFocusId = useUiStore((state) => state.cardFocusId);
  const inspectorNodeId = useUiStore((state) => state.inspectorNodeId);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const focusCard = useUiStore((state) => state.focusCard);
  const snapshot = useWorkspaceSnapshot();

  const cardId = cardFocusId ?? inspectorNodeId ?? selectedNodeIds[0] ?? null;

  const rollup = useMemo(() => {
    if (!rollupOpen || cardId === null) return null;
    return cardRollup({
      cardId,
      cards: snapshot.cards,
      edges: snapshot.edges,
      references: snapshot.references,
      placements: snapshot.placements,
      activeBoardId,
      titles: new Map(snapshot.cards.map((card) => [card.id, workspace.displayTitle(card.id)])),
      typeNames: new Map(snapshot.types.map((type) => [type.id, type.name])),
    });
  }, [rollupOpen, cardId, snapshot, activeBoardId, workspace]);

  /** Opening a member goes to the board it sits on, not always this one. */
  const openMember = (memberId: string) => {
    const member = rollup?.members.find((entry) => entry.cardId === memberId);
    const boardId = member?.boardId ?? activeBoardId;
    if (boardId) focusCard(memberId, boardId);
  };

  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 z-20 flex max-w-[320px] flex-col items-start gap-2"
      data-testid="rollup-rail"
    >
      <button
        type="button"
        aria-pressed={rollupOpen}
        data-testid="rollup-toggle"
        className="pointer-events-auto rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] shadow-sm hover:bg-black/5 dark:hover:bg-white/10"
        onClick={toggleRollup}
      >
        Rollup
      </button>
      {rollupOpen ? (
        <div className="pointer-events-auto flex flex-col gap-1" data-testid="rollup-panel">
          {rollup ? (
            <RollupSummary rollup={rollup} onOpen={openMember} />
          ) : (
            <p className="rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-2.5 py-1.5 text-[11px] text-[var(--ink-muted)]">
              Select a card to see what it hides.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
