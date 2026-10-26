import type { Card, WorkspaceDocument } from "@suite/graph";
import { applyWorkspaceChange } from "../hooks/snapshotChanges";
import { mergeSnapshots, type WorkspaceSnapshot } from "../hooks/snapshotMerge";

export function readWorkspace(workspace: WorkspaceDocument): WorkspaceSnapshot {
  return {
    boards: workspace.listBoards(),
    cards: workspace.listCards(),
    placements: workspace.listPlacements(),
    edges: workspace.listEdges(),
    types: workspace.listTypes(),
    tags: workspace.listTags(),
    sections: workspace.listSections(),
    references: workspace.listReferences(),
  };
}

/**
 * Fires with the ids of cards whose record or text changed since the last
 * notification. Text edits arrive per commit batch, so a burst of typing is one
 * call carrying the same id more than once.
 */
export type CardChangeListener = (cardIds: readonly string[]) => void;

/**
 * One snapshot per workspace, shared by every consumer. Consumers subscribe
 * through a selector so a card re-renders only when its own record changes;
 * `WorkspaceDocument` hands out stable record objects, which is what lets
 * `Object.is` do the filtering.
 */
export class WorkspaceSnapshotStore {
  private snapshot: WorkspaceSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly cardListeners = new Set<CardChangeListener>();
  private readonly unsubscribe: () => void;
  private stopText: (() => void) | null = null;
  private cardIndex = new Map<string, Card>();
  private indexedCards: Card[] | null = null;

  constructor(private readonly workspace: WorkspaceDocument) {
    this.snapshot = readWorkspace(workspace);
    this.unsubscribe = workspace.observe((change) => {
      this.snapshot = applyWorkspaceChange(this.snapshot, change);
      this.emit();
      if (change.section === "cards") this.emitCardChanges([change.key]);
    });
  }

  getSnapshot = (): WorkspaceSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Re-reads the whole document. Hydration and the first server sync can land
   * between the initial read and the observer registration, so the shell calls
   * this when either gate flips.
   */
  refresh = (): void => {
    this.snapshot = mergeSnapshots(this.snapshot, readWorkspace(this.workspace));
    this.emit();
  };

  card = (cardId: string): Card | undefined => this.cardsById().get(cardId);

  /**
   * Card text lives in the `content` and `titles` containers, which carry no
   * record change, so the search index cannot rebuild from the snapshot alone.
   * The document subscription that reports those paths lives here: one stream
   * for every text consumer, started on the first subscriber and stopped with
   * the last, because most sessions never open the library.
   */
  subscribeCardChanges = (listener: CardChangeListener): (() => void) => {
    this.cardListeners.add(listener);
    this.stopText ??= this.watchCardText();
    return () => {
      this.cardListeners.delete(listener);
      if (this.cardListeners.size > 0) return;
      this.stopText?.();
      this.stopText = null;
    };
  };

  destroy(): void {
    this.unsubscribe();
    this.stopText?.();
    this.stopText = null;
    this.listeners.clear();
    this.cardListeners.clear();
  }

  private watchCardText(): () => void {
    return this.workspace.doc.subscribe((batch) => {
      const changed: string[] = [];
      for (const event of batch.events) {
        const root = event.path[0];
        if (root !== "content" && root !== "titles" && root !== "cards") continue;
        const cardId = event.path[1];
        if (typeof cardId === "string") changed.push(cardId);
        else if (event.diff.type === "map") changed.push(...Object.keys(event.diff.updated));
      }
      if (changed.length > 0) this.emitCardChanges(changed);
    });
  }

  private emitCardChanges(cardIds: readonly string[]): void {
    for (const listener of this.cardListeners) listener(cardIds);
  }

  private cardsById(): Map<string, Card> {
    if (this.indexedCards === this.snapshot.cards) return this.cardIndex;
    this.cardIndex = new Map(this.snapshot.cards.map((card) => [card.id, card]));
    this.indexedCards = this.snapshot.cards;
    return this.cardIndex;
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const stores = new WeakMap<WorkspaceDocument, WorkspaceSnapshotStore>();

export function workspaceSnapshotStore(workspace: WorkspaceDocument): WorkspaceSnapshotStore {
  let store = stores.get(workspace);
  if (!store) {
    store = new WorkspaceSnapshotStore(workspace);
    stores.set(workspace, store);
  }
  return store;
}
