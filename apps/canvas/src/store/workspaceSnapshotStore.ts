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
  };
}

/**
 * One snapshot per workspace, shared by every consumer. Consumers subscribe
 * through a selector so a card re-renders only when its own record changes;
 * `WorkspaceDocument` hands out stable record objects, which is what lets
 * `Object.is` do the filtering.
 */
export class WorkspaceSnapshotStore {
  private snapshot: WorkspaceSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private cardIndex = new Map<string, Card>();
  private indexedCards: Card[] | null = null;

  constructor(private readonly workspace: WorkspaceDocument) {
    this.snapshot = readWorkspace(workspace);
    this.unsubscribe = workspace.observe((change) => {
      this.snapshot = applyWorkspaceChange(this.snapshot, change);
      this.emit();
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

  destroy(): void {
    this.unsubscribe();
    this.listeners.clear();
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
