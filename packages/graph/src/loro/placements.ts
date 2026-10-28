import {
  type ApplyLayoutPlanOptions,
  clampLayoutCoordinate,
  LAYOUT_APPLY_ORIGIN,
  type LayoutPlan,
  LayoutPlanError,
  type LayoutPlanSummary,
  layoutPlanIssues,
  MIN_LAYOUT_SECTION_HEIGHT,
  MIN_LAYOUT_SECTION_WIDTH,
  parseLayoutPlan,
} from "../layoutPlan.js";
import { placementFromMap, sortByLayer } from "../records/entities.js";
import { isMap, readNumber } from "../records/values.js";
import type { Card, Placement } from "../schema.js";
import { MIN_RANK_GAP, PORTAL_BOARD_FIELD_ID, placementKey, STRUCT_ORIGIN } from "./constants.js";
import type { DocContext } from "./context.js";
import { type LayerAction, type PlacementMoveInput, placementMoveSchema } from "./model.js";

/**
 * Owns placements: which card sits where on which board, its size, its stacking order,
 * the layout plans that move many at once, and the trash lists read through them.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
export function placementsMethods(ctx: DocContext) {
  return {
    cachedPlacement(key: string): Placement | undefined {
      const cached = ctx.placementCache.get(key);
      if (cached) return cached;
      const value = ctx.placements.get(key);
      if (!isMap(value)) return undefined;
      const placement = placementFromMap(key, value);
      ctx.placementCache.set(key, placement);
      return placement;
    },

    listPlacements(): Placement[] {
      return ctx.placements
        .keys()
        .map((key) => ctx.api.placements.cachedPlacement(key))
        .filter((placement): placement is Placement => placement !== undefined);
    },

    getPlacementByKey(key: string): Placement | undefined {
      return ctx.api.placements.cachedPlacement(key);
    },

    listCardPlacements(cardId: string): Placement[] {
      return ctx.api.placements
        .listPlacements()
        .filter((placement) => placement.cardId === cardId)
        .sort((a, b) => a.createdAt - b.createdAt || a.boardId.localeCompare(b.boardId));
    },

    getPlacement(boardId: string, cardId: string): Placement | undefined {
      return ctx.api.placements.cachedPlacement(placementKey(boardId, cardId));
    },

    homeBoardId(cardId: string): string | null {
      return ctx.api.placements.listCardPlacements(cardId)[0]?.boardId ?? null;
    },

    listBoardPlacements(boardId: string): Placement[] {
      return sortByLayer(
        ctx.api.placements.listPlacements().filter((placement) => placement.boardId === boardId),
      );
    },

    listBoardCards(boardId: string): Card[] {
      return ctx.api.placements.listBoardPlacements(boardId).flatMap((placement) => {
        const card = ctx.api.cards.getCard(placement.cardId);
        return card && !card.deletedAt ? [card] : [];
      });
    },

    listInboxCards(): Card[] {
      return ctx.api.cards
        .listCards()
        .filter(
          (card) => !card.deletedAt && ctx.api.placements.listCardPlacements(card.id).length === 0,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    },

    listTrashedCards(): Card[] {
      return ctx.api.cards
        .listCards()
        .filter((card) => Boolean(card.deletedAt))
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0) || a.id.localeCompare(b.id));
    },

    nextPlacementTime(): number {
      const latest = ctx.api.placements
        .listPlacements()
        .reduce((max, placement) => Math.max(max, placement.createdAt), 0);
      return Math.max(Date.now(), latest + 1);
    },

    placeCardInternal(
      boardId: string,
      cardId: string,
      position: { x: number; y: number },
    ): Placement | null {
      if (!ctx.cards.get(cardId) || !ctx.boards.get(boardId)) return null;

      const existing = ctx.api.placements.getPlacement(boardId, cardId);
      if (existing) {
        const fields = ctx.placements.get(placementKey(boardId, cardId));
        if (isMap(fields)) {
          fields.set("x", position.x);
          fields.set("y", position.y);
        }
        return { ...existing, ...position };
      }

      const placements = ctx.api.placements.listBoardPlacements(boardId);
      const top = placements.length > 0 ? (placements.at(-1)?.z ?? 0) + 1 : 0;
      const placement: Placement = {
        boardId,
        cardId,
        x: position.x,
        y: position.y,
        z: top,
        createdAt: ctx.api.placements.nextPlacementTime(),
      };
      const fields = ctx.placements.ensureMergeableMap(placementKey(boardId, cardId));
      fields.set("boardId", boardId);
      fields.set("cardId", cardId);
      fields.set("x", placement.x);
      fields.set("y", placement.y);
      fields.set("z", placement.z);
      fields.set("createdAt", placement.createdAt);
      return placement;
    },

    placeCard(
      boardId: string,
      cardId: string,
      position: { x: number; y: number },
    ): Placement | null {
      const placement = ctx.api.placements.placeCardInternal(boardId, cardId, position);
      if (placement) ctx.commit(`${STRUCT_ORIGIN}place-card`);
      return placement;
    },

    /**
     * One portal per target board, per host board: the earliest one stays.
     *
     * A board is opened from a board, and a second portal to the same place on the same
     * board says nothing the first does not. Older documents collected extras while a
     * placement could make a portal for a board that already had one; this folds them
     * back to one, as a single undo step.
     *
     * @returns how many portals were removed.
     */
    pruneDuplicatePortals(): number {
      const kept = new Map<string, { cardId: string; createdAt: number }>();
      const extra: string[] = [];
      for (const placement of ctx.api.placements.listPlacements()) {
        const card = ctx.api.cards.getCard(placement.cardId);
        const target = card?.properties[PORTAL_BOARD_FIELD_ID];
        if (typeof target !== "string" || target.length === 0) continue;
        const key = `${placement.boardId}|${target}`;
        const first = kept.get(key);
        if (first === undefined) {
          kept.set(key, { cardId: placement.cardId, createdAt: card?.createdAt ?? 0 });
          continue;
        }
        // The earliest record wins, so which portal survives does not depend on order.
        if ((card?.createdAt ?? 0) < first.createdAt) {
          kept.set(key, { cardId: placement.cardId, createdAt: card?.createdAt ?? 0 });
          extra.push(first.cardId);
          continue;
        }
        extra.push(placement.cardId);
      }
      if (extra.length === 0) return 0;
      ctx.batch(`${STRUCT_ORIGIN}prune-portals`, () => {
        for (const cardId of extra) ctx.api.cards.trashCard(cardId);
      });
      return extra.length;
    },

    /**
     * Take a card off a board, and with it every link that touched it there.
     *
     * A link is a relationship *on* a board, between two things drawn on it, so taking
     * one end off the board ends the relationship. Keeping the record made a re-place
     * bring an old line back: thread three cards, take them off, fan the same three, and
     * the thread's last line reappeared beside the fan's spokes, which read as one press
     * writing two links.
     */
    unplaceCard(boardId: string, cardId: string): void {
      const edges = ctx.api.edges
        .listEdges()
        .filter(
          (edge) => edge.boardId === boardId && (edge.source === cardId || edge.target === cardId),
        );
      for (const edge of edges) ctx.edges.delete(edge.id);
      ctx.placements.delete(placementKey(boardId, cardId));
      ctx.commit(`${STRUCT_ORIGIN}unplace-card`);
    },

    updatePlacementPosition(
      boardId: string,
      cardId: string,
      position: { x: number; y: number },
    ): void {
      const fields = ctx.placements.get(placementKey(boardId, cardId));
      if (!isMap(fields)) return;
      fields.set("x", position.x);
      fields.set("y", position.y);
      ctx.commit(`${STRUCT_ORIGIN}move-card`);
    },

    /**
     * One commit for a multi-card drag, mirroring `moveSectionsBatch`: only `x`/`y`
     * are written, unknown placements and moves that change nothing are skipped,
     * and a batch with no effective change produces no commit (so no empty undo
     * step). The result does not depend on the order of `moves`.
     */
    movePlacements(boardId: string, moves: PlacementMoveInput[]): void {
      let changed = false;
      for (const move of moves) {
        const parsed = placementMoveSchema.safeParse(move);
        if (!parsed.success) continue;
        const fields = ctx.placements.get(placementKey(boardId, parsed.data.cardId));
        if (!isMap(fields)) continue;
        if (
          readNumber(fields, "x") === parsed.data.x &&
          readNumber(fields, "y") === parsed.data.y
        ) {
          continue;
        }
        fields.set("x", parsed.data.x);
        fields.set("y", parsed.data.y);
        changed = true;
      }
      if (changed) ctx.commit(`${STRUCT_ORIGIN}move-cards`);
    },

    updatePlacementSize(
      boardId: string,
      cardId: string,
      size: { width: number; height: number },
    ): void {
      const fields = ctx.placements.get(placementKey(boardId, cardId));
      if (!isMap(fields)) return;
      fields.set("width", size.width);
      fields.set("height", size.height);
      ctx.commit(`${STRUCT_ORIGIN}resize-card`);
    },

    /** Commits position and size together so a corner drag is one undo step. */
    updatePlacementGeometry(
      boardId: string,
      cardId: string,
      geometry: { x: number; y: number; width: number; height: number },
    ): void {
      const fields = ctx.placements.get(placementKey(boardId, cardId));
      if (!isMap(fields)) return;
      fields.set("x", geometry.x);
      fields.set("y", geometry.y);
      fields.set("width", geometry.width);
      fields.set("height", geometry.height);
      ctx.commit(`${STRUCT_ORIGIN}resize-card`);
    },

    /**
     * Applies a one-shot layout plan: positions, sizes and section geometry, all
     * in one batch so the whole command is a single undo step. The plan is
     * validated up front; nothing is written when it has issues or would not
     * change anything, and only changed fields are set.
     */
    applyLayoutPlan(plan: LayoutPlan, options: ApplyLayoutPlanOptions = {}): LayoutPlanSummary {
      const parsed = parseLayoutPlan(plan);
      const issues = layoutPlanIssues(parsed, {
        hasBoard: (id) => ctx.boards.get(id) !== undefined,
        hasCard: (id) => ctx.cards.get(id) !== undefined,
        hasSection: (id) => ctx.sections.get(id) !== undefined,
        placedBoards: (cardId) =>
          ctx.api.placements.listCardPlacements(cardId).map((entry) => entry.boardId),
      });
      if (issues.length > 0) throw new LayoutPlanError(issues);

      interface StagedPlacement {
        boardId: string;
        cardId: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
      }

      const staged = new Map<string, StagedPlacement>();
      const stage = (boardId: string, cardId: string): StagedPlacement => {
        const key = placementKey(boardId, cardId);
        const existing = staged.get(key);
        if (existing) return existing;
        const created: StagedPlacement = { boardId, cardId };
        staged.set(key, created);
        return created;
      };

      for (const placement of parsed.placements) {
        const next = stage(placement.boardId, placement.cardId);
        next.x = clampLayoutCoordinate(placement.x);
        next.y = clampLayoutCoordinate(placement.y);
        if (placement.width !== undefined) next.width = placement.width;
        if (placement.height !== undefined) next.height = placement.height;
      }
      // A portal size is a placement size too; explicit placement geometry wins.
      for (const [cardId, size] of Object.entries(parsed.portalSizes ?? {})) {
        const boardIds = new Set<string>();
        for (const placement of parsed.placements) {
          if (placement.cardId === cardId) boardIds.add(placement.boardId);
        }
        if (boardIds.size === 0) {
          for (const placement of ctx.api.placements.listCardPlacements(cardId))
            boardIds.add(placement.boardId);
        }
        for (const boardId of boardIds) {
          const next = stage(boardId, cardId);
          next.width ??= size.width;
          next.height ??= size.height;
        }
      }

      interface PlacementChange {
        boardId: string;
        cardId: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        create: boolean;
      }

      const placementChanges: PlacementChange[] = [];
      const boards = new Set<string>();
      for (const next of staged.values()) {
        const current = ctx.api.placements.getPlacement(next.boardId, next.cardId);
        if (!current) {
          if (next.x === undefined || next.y === undefined) continue;
          const created: PlacementChange = {
            boardId: next.boardId,
            cardId: next.cardId,
            x: next.x,
            y: next.y,
            create: true,
          };
          if (next.width !== undefined) created.width = next.width;
          if (next.height !== undefined) created.height = next.height;
          placementChanges.push(created);
          boards.add(next.boardId);
          continue;
        }
        const change: PlacementChange = {
          boardId: next.boardId,
          cardId: next.cardId,
          create: false,
        };
        let changed = false;
        if (next.x !== undefined && next.x !== current.x) {
          change.x = next.x;
          changed = true;
        }
        if (next.y !== undefined && next.y !== current.y) {
          change.y = next.y;
          changed = true;
        }
        if (next.width !== undefined && next.width !== current.width) {
          change.width = next.width;
          changed = true;
        }
        if (next.height !== undefined && next.height !== current.height) {
          change.height = next.height;
          changed = true;
        }
        if (!changed) continue;
        placementChanges.push(change);
        boards.add(next.boardId);
      }

      interface SectionChange {
        id: string;
        boardId: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }

      const sectionChanges: SectionChange[] = [];
      for (const section of parsed.sections ?? []) {
        const current = ctx.api.sections.getSection(section.sectionId);
        if (!current) continue;
        const x = clampLayoutCoordinate(section.x);
        const y = clampLayoutCoordinate(section.y);
        const width = Math.max(MIN_LAYOUT_SECTION_WIDTH, section.width);
        const height = Math.max(MIN_LAYOUT_SECTION_HEIGHT, section.height);
        if (
          current.x === x &&
          current.y === y &&
          current.width === width &&
          current.height === height
        ) {
          continue;
        }
        sectionChanges.push({ id: current.id, boardId: current.boardId, x, y, width, height });
        boards.add(current.boardId);
      }

      if (placementChanges.length === 0 && sectionChanges.length === 0) {
        return { placements: 0, sections: 0, boards: 0 };
      }

      ctx.batch(options.origin ?? LAYOUT_APPLY_ORIGIN, () => {
        for (const change of placementChanges) {
          if (change.create) {
            ctx.api.placements.placeCardInternal(change.boardId, change.cardId, {
              x: change.x ?? 0,
              y: change.y ?? 0,
            });
          }
          const fields = ctx.placements.get(placementKey(change.boardId, change.cardId));
          if (!isMap(fields)) continue;
          if (!change.create) {
            if (change.x !== undefined) fields.set("x", change.x);
            if (change.y !== undefined) fields.set("y", change.y);
          }
          if (change.width !== undefined) fields.set("width", change.width);
          if (change.height !== undefined) fields.set("height", change.height);
        }
        const now = Date.now();
        for (const change of sectionChanges) {
          const fields = ctx.sections.get(change.id);
          if (!isMap(fields)) continue;
          fields.set("x", change.x);
          fields.set("y", change.y);
          fields.set("width", change.width);
          fields.set("height", change.height);
          fields.set("updatedAt", now);
        }
      });

      return {
        placements: placementChanges.length,
        sections: sectionChanges.length,
        boards: boards.size,
      };
    },

    moveLayer(boardId: string, cardId: string, action: LayerAction): void {
      const ordered = ctx.api.placements.listBoardPlacements(boardId);
      const index = ordered.findIndex((placement) => placement.cardId === cardId);
      const placement = ordered[index];
      if (!placement) return;

      const rest = ordered.filter((entry) => entry.cardId !== cardId);
      const target =
        action === "front"
          ? rest.length
          : action === "back"
            ? 0
            : action === "forward"
              ? Math.min(rest.length, index + 1)
              : Math.max(0, index - 1);
      if (target === index) return;

      const below = rest[target - 1]?.z;
      const above = rest[target]?.z;
      const rank = ctx.api.placements.rankBetween(below, above);
      const fields = ctx.placements.get(placementKey(boardId, cardId));
      if (!isMap(fields)) return;

      const tooTight = below !== undefined && above !== undefined && above - below < MIN_RANK_GAP;
      if (!tooTight) {
        fields.set("z", rank);
        ctx.commit(`${STRUCT_ORIGIN}layer`);
        return;
      }

      const next = [...rest];
      next.splice(target, 0, placement);
      next.forEach((entry, layer) => {
        const entryFields = ctx.placements.get(placementKey(boardId, entry.cardId));
        if (!isMap(entryFields) || entry.z === layer) return;
        entryFields.set("z", layer);
      });
      ctx.commit(`${STRUCT_ORIGIN}layer-renumber`);
    },

    rankBetween(below: number | undefined, above: number | undefined): number {
      if (below === undefined && above === undefined) return 0;
      if (below === undefined) return (above ?? 0) - 1;
      if (above === undefined) return below + 1;
      return below + (above - below) / 2;
    },
  };
}
