import type { Card } from "@suite/graph";
import { useEffect, useRef, useState } from "react";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { announce } from "./announcer";

/**
 * Speaks the document changes that are currently silent: a card made or
 * trashed, a board switch, a selection that changed, a peer arriving or
 * leaving. Every one of them is read from a store that already exists — the
 * snapshot store, the UI store, the presence store — so this adds no event
 * system of its own.
 *
 * Card changes are gated on a local commit. A peer's edit lands in the same
 * snapshot, and announcing their work as though it were the reader's own would
 * be a lie about who did what.
 */

/** A pointer sweeping a marquee reads as one selection, not thirty. */
export const SELECTION_SETTLE_MS = 180;

function cardMessage(created: number, trashed: number): string | null {
  const parts: string[] = [];
  if (created === 1) parts.push("Card created");
  else if (created > 1) parts.push(`${created} cards created`);
  if (trashed === 1) parts.push("Card moved to Trash");
  else if (trashed > 1) parts.push(`${trashed} cards moved to Trash`);
  return parts.length === 0 ? null : parts.join(". ");
}

function countCreated(cards: readonly Card[], previous: ReadonlyMap<string, boolean>): number {
  let created = 0;
  for (const card of cards) if (!previous.has(card.id)) created += 1;
  return created;
}

function countTrashed(cards: readonly Card[], previous: ReadonlyMap<string, boolean>): number {
  let trashed = 0;
  for (const card of cards) {
    if (card.deletedAt && previous.get(card.id) === false) trashed += 1;
  }
  return trashed;
}

export function useCardAnnouncements(): void {
  const workspace = useCanvasStore((state) => state.workspace);
  const cards = useWorkspaceSnapshot().cards;
  const [localCommits, setLocalCommits] = useState(0);
  const announcedCommits = useRef(0);
  const seen = useRef<Map<string, boolean> | null>(null);

  useEffect(
    () =>
      workspace.doc.subscribeLocalUpdates(() => {
        setLocalCommits((count) => count + 1);
      }),
    [workspace],
  );

  useEffect(() => {
    const previous = seen.current;
    seen.current = new Map(cards.map((card) => [card.id, Boolean(card.deletedAt)]));
    // The first read is the baseline, and hydration or a server merge is an
    // import rather than a local commit.
    if (previous === null) {
      announcedCommits.current = localCommits;
      return;
    }
    // Every local commit re-runs this, including a keystroke that changes no card
    // record, so a stale count can never make a peer's card look like this tab's.
    if (localCommits === announcedCommits.current) return;
    announcedCommits.current = localCommits;
    const message = cardMessage(countCreated(cards, previous), countTrashed(cards, previous));
    if (message !== null) announce(message);
  }, [cards, localCommits]);
}

export function useBoardAnnouncements(): void {
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const boards = useWorkspaceSnapshot().boards;
  const previous = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (previous.current === activeBoardId) return;
    const first = previous.current === undefined;
    previous.current = activeBoardId;
    if (first || activeBoardId === null) return;
    const name = boards.find((board) => board.id === activeBoardId)?.name ?? null;
    announce(name === null ? "Board switched" : `Board: ${name}`);
  }, [activeBoardId, boards]);
}

export function useSelectionAnnouncements(): void {
  const count = useUiStore(
    (state) =>
      state.selectedNodeIds.length +
      state.selectedEdgeIds.length +
      (state.selectedSectionId === null ? 0 : 1),
  );
  const previous = useRef<number | null>(null);

  useEffect(() => {
    if (previous.current === null) {
      previous.current = count;
      return;
    }
    if (previous.current === count) return;
    const timer = setTimeout(() => {
      previous.current = count;
      announce(
        count === 0
          ? "Nothing selected"
          : count === 1
            ? "1 item selected"
            : `${count} items selected`,
      );
    }, SELECTION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [count]);
}

export function usePeerAnnouncements(): void {
  const peers = usePresenceStore((state) => state.peers);
  const seen = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const next = new Map(Object.values(peers).map((peer) => [peer.clientId, peer.user.name]));
    const previous = seen.current;
    seen.current = next;
    if (previous === null) return;
    const parts: string[] = [];
    for (const [id, name] of next) if (!previous.has(id)) parts.push(`${name} joined`);
    for (const [id, name] of previous) if (!next.has(id)) parts.push(`${name} left`);
    if (parts.length > 0) announce(parts.join(". "));
  }, [peers]);
}

/** Mounted once by the shell. Renders nothing; it only listens. */
export function DocumentAnnouncer() {
  useCardAnnouncements();
  useBoardAnnouncements();
  useSelectionAnnouncements();
  usePeerAnnouncements();
  return null;
}
