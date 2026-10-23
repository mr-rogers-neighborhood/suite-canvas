/**
 * The canonical card projection for the ICE surface: spawn, remove and reconcile
 * the entities that stand for one root board's placements.
 *
 * ICE's ECS is projection state, never document truth. This module is the only
 * place the two directions meet:
 *
 * - `reconcile()` reads canonical placements and makes the entity set match:
 *   a placement with no entity is spawned, an entity whose card is gone or
 *   trashed is removed, and a placement whose geometry moved is re-spawned.
 * - A local gesture never calls `reconcile()`. It commits through the workspace
 *   first (one commit), and the ICE entity is already where the user left it.
 *
 * Removal and re-spawn go through supported engine ops (`setSelection` +
 * `deleteSelection`, `spawnWidget`) rather than `world.destroy`, because ICE
 * holds the durable store behind the world: a world-only destroy is written
 * back on the next flush.
 *
 * Why re-spawn instead of "move the entity": ICE 0.16.0 exposes no supported
 * `setPosition`. Re-spawning one card is cheap, keeps the projection derived,
 * and means an undo or a peer edit arrives the same way a fresh load does.
 */

import type { Placement } from "@suite/graph";

/** The slice of a placement this module needs. */
export type CanonicalPlacement = Pick<
  Placement,
  "boardId" | "cardId" | "x" | "y" | "width" | "height"
> & {
  /**
   * What the card says, as one text flow (title, blank line, body). A card's
   * face is drawn from this, so a change to it replaces the entity the same way
   * a move does.
   */
  readonly text?: string;
};

/** What the lifecycle needs from the ICE engine. Kept structural so it is testable. */
export interface CardProjectionOps<TEntity> {
  readonly entity: TEntity;
  readonly boardId: string;
  readonly cardId: string;
}

export interface CardProjectionHost<TEntity> {
  /** Spawn one card at a canonical placement; returns the new entity. */
  spawn(placement: CanonicalPlacement): TEntity;
  /**
   * Everything that needs a replace (rather than an in-place move) when it
   * changes: the card's text, and the kind its size puts it on. Absent, only
   * the text is compared.
   */
  keyOf?(placement: CanonicalPlacement): string;
  /** Remove one entity through the engine's own delete path. */
  remove(entity: TEntity): void;
  /** The entity's current box in board units, or `null` when it has no geometry. */
  boxOf(entity: TEntity): { x: number; y: number; width: number; height: number } | null;
}

export interface ReconcileReport<TEntity> {
  readonly spawned: readonly TEntity[];
  readonly removed: readonly TEntity[];
  /** Cards whose canonical geometry changed and were re-spawned. */
  readonly moved: readonly TEntity[];
  readonly failures: readonly string[];
}

/** Sub-pixel drift is not a move; snapping and rounding both stay under this. */
export const RECONCILE_EPSILON = 0.5;

function sameBox(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  epsilon = RECONCILE_EPSILON,
): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  );
}

/** A placement's box; a card without a stored size uses the given natural size. */
export function placementBox(
  placement: CanonicalPlacement,
  natural: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width ?? natural.width,
    height: placement.height ?? natural.height,
  };
}

export class CardProjection<TEntity> {
  private readonly host: CardProjectionHost<TEntity>;
  private readonly byCard = new Map<string, TEntity>();
  private readonly keyOf = new Map<string, string>();
  private readonly byEntity = new Map<TEntity, { cardId: string; boardId: string }>();

  constructor(host: CardProjectionHost<TEntity>) {
    this.host = host;
  }

  register(entity: TEntity, cardId: string, boardId: string, key = ""): void {
    this.byCard.set(cardId, entity);
    this.byEntity.set(entity, { cardId, boardId });
    this.keyOf.set(cardId, key);
  }

  /** The render key this card was spawned with (text, rung) — for diagnostics. */
  renderKeyOf(cardId: string): string | undefined {
    return this.keyOf.get(cardId);
  }

  entityOf(cardId: string): TEntity | undefined {
    return this.byCard.get(cardId);
  }

  infoOf(entity: TEntity): { cardId: string; boardId: string } | undefined {
    return this.byEntity.get(entity);
  }

  /** Every entity this projection owns, for hit-testing and selection. */
  entities(): readonly TEntity[] {
    return [...this.byEntity.keys()];
  }

  /** Spawn one canonical placement and register it. */
  spawn(placement: CanonicalPlacement): TEntity {
    const entity = this.host.spawn(placement);
    this.register(entity, placement.cardId, placement.boardId, this.keyFor(placement));
    return entity;
  }

  private keyFor(placement: CanonicalPlacement): string {
    return this.host.keyOf?.(placement) ?? placement.text ?? "";
  }

  /** Remove one card's entity; a no-op for a card with no entity. */
  removeCard(cardId: string): boolean {
    const entity = this.byCard.get(cardId);
    if (entity === undefined) return false;
    this.byCard.delete(cardId);
    this.byEntity.delete(entity);
    this.keyOf.delete(cardId);
    this.host.remove(entity);
    return true;
  }

  /**
   * Make the entity set match the canonical placements, without touching
   * cards whose geometry already agrees. Call this after an undo, a redo, a
   * share join or any change this surface did not author.
   *
   * `natural` is the card's default size, used when the placement stores none.
   * `force` re-spawns every card regardless of geometry (a document swap).
   */
  reconcile(
    placements: readonly CanonicalPlacement[],
    natural: { width: number; height: number },
    options: { force?: boolean } = {},
  ): ReconcileReport<TEntity> {
    const spawned: TEntity[] = [];
    const removed: TEntity[] = [];
    const moved: TEntity[] = [];
    const failures: string[] = [];

    const wanted = new Map<string, CanonicalPlacement>();
    for (const placement of placements) {
      // One placement per board and card; the first wins, like the graph layer.
      if (!wanted.has(placement.cardId)) wanted.set(placement.cardId, placement);
    }

    for (const [cardId, entity] of [...this.byCard]) {
      if (wanted.has(cardId)) continue;
      this.byCard.delete(cardId);
      this.byEntity.delete(entity);
      this.keyOf.delete(cardId);
      try {
        this.host.remove(entity);
        removed.push(entity);
      } catch (error) {
        failures.push(`remove ${cardId}: ${describeError(error)}`);
      }
    }

    for (const [cardId, placement] of wanted) {
      const existing = this.byCard.get(cardId);
      if (existing === undefined) {
        try {
          spawned.push(this.spawn(placement));
        } catch (error) {
          failures.push(`spawn ${cardId}: ${describeError(error)}`);
        }
        continue;
      }
      if (options.force !== true) {
        const current = this.host.boxOf(existing);
        const sameFace = (this.keyOf.get(cardId) ?? "") === this.keyFor(placement);
        if (sameFace && current !== null && sameBox(current, placementBox(placement, natural))) {
          continue;
        }
      }
      // Geometry or text diverged: replace rather than mutate. The entity is
      // disposable, and a replacement lands with the new face already written.
      this.byCard.delete(cardId);
      this.byEntity.delete(existing);
      this.keyOf.delete(cardId);
      try {
        this.host.remove(existing);
      } catch (error) {
        failures.push(`remove ${cardId}: ${describeError(error)}`);
      }
      try {
        moved.push(this.spawn(placement));
      } catch (error) {
        failures.push(`respawn ${cardId}: ${describeError(error)}`);
      }
    }

    return { spawned, removed, moved, failures };
  }

  /** Drop every entity; used when the surface unmounts. */
  dispose(): void {
    const entities = [...this.byEntity.keys()];
    this.byCard.clear();
    this.byEntity.clear();
    for (const entity of entities) {
      try {
        this.host.remove(entity);
      } catch {
        // Teardown is best effort; the engine is about to be disposed.
      }
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return String(error);
}
