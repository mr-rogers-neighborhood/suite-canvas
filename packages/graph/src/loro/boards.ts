import { createConnectorId } from "../connectors.js";
import { edgeEndpoints, type LinkEndpoint } from "../links.js";
import {
  isMap,
  readIdSet,
  readNumber,
  readString,
  readSurfaceStyle,
  writeIdSet,
  writeSurfaceStyle,
} from "../records/values.js";
import {
  type Board,
  boardSchema,
  type Connector,
  graphEdgeSchema,
  type Placement,
  sectionSchema,
} from "../schema.js";
import type { SurfaceStyle } from "../style.js";
import {
  DEFAULT_BOARD_ID,
  PORTAL_BOARD_FIELD_ID,
  placementKey,
  STRUCT_ORIGIN,
} from "./constants.js";
import type { DocContext } from "./context.js";
import type { DuplicateBoardOptions } from "./model.js";

/**
 * Owns boards: their CRUD, colour, paint, tags, covers, templates, the portal target a
 * portal card points at, and the copy that duplicates a board with everything drawn on it.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
export function boardsMethods(ctx: DocContext) {
  return {
    cachedBoard(id: string): Board | undefined {
      const cached = ctx.boardCache.get(id);
      if (cached) return cached;
      const value = ctx.boards.get(id);
      if (!isMap(value)) return undefined;
      const color = readString(value, "color");
      const coverAttachmentId = readString(value, "coverAttachmentId");
      const template = value.get("template");
      const style = readSurfaceStyle(value);
      const board = boardSchema.parse({
        id,
        name: readString(value, "name") ?? "Board",
        createdAt: readNumber(value, "createdAt") ?? 0,
        updatedAt: readNumber(value, "updatedAt") ?? 0,
        // A board stored before tags existed simply has no map; it reads as none.
        tags: readIdSet(value.get("tags")),
        // Both have been in the schema since boards became identities; nothing read
        // them back, so a colour write was invisible after the next cache fill.
        ...(color ? { color } : {}),
        ...(coverAttachmentId ? { coverAttachmentId } : {}),
        ...(template === true ? { template } : {}),
        ...(style ? { style } : {}),
      });
      ctx.boardCache.set(id, board);
      return board;
    },

    listBoards(): Board[] {
      return ctx.boards
        .keys()
        .map((id) => ctx.api.boards.cachedBoard(id))
        .filter((board): board is Board => board !== undefined)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },

    getBoard(id: string): Board | undefined {
      return ctx.api.boards.cachedBoard(id);
    },

    createBoard(input: { id?: string; name?: string } = {}): Board {
      const now = Date.now();
      const board: Board = {
        id: input.id ?? crypto.randomUUID(),
        name: input.name ?? `Board ${ctx.boards.size + 1}`,
        tags: [],
        createdAt: now,
        updatedAt: now,
      };
      const fields = ctx.boards.ensureMergeableMap(board.id);
      fields.set("name", board.name);
      fields.set("createdAt", board.createdAt);
      fields.set("updatedAt", board.updatedAt);
      ctx.commit(`${STRUCT_ORIGIN}create-board`);
      return board;
    },

    renameBoard(id: string, name: string): void {
      const board = ctx.api.boards.getBoard(id);
      if (!board) return;
      const trimmed = name.trim();
      if (trimmed.length === 0) return;
      const fields = ctx.boards.get(id);
      if (!isMap(fields)) return;
      fields.set("name", trimmed);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}rename-board`);
    },

    /** A board's colour, or null to go back to the default. Boards are identities. */
    setBoardColor(id: string, color: Board["color"] | null): void {
      const fields = ctx.boards.get(id);
      if (!isMap(fields)) return;
      if (color) fields.set("color", color);
      else fields.delete("color");
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}board-color`);
    },

    /**
     * The paint of one surface (ADR-0051).
     * One method per surface keeps the write path obvious, and each writes the
     * whole record: a style is edited as a unit, and a partial merge would make
     * "remove the border" indistinguishable from "never had one".
     */
    setBoardStyle(id: string, style: SurfaceStyle | null): void {
      const fields = ctx.boards.get(id);
      if (!isMap(fields)) return;
      writeSurfaceStyle(fields, style);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}board-style`);
    },

    /** Whether a board is offered as a template. Never changes what it holds. */
    setBoardTemplate(id: string, template: boolean): void {
      const fields = ctx.boards.get(id);
      if (!isMap(fields)) return;
      if (template) fields.set("template", true);
      else fields.delete("template");
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}board-template`);
    },

    /** A board's cover image; null returns the portal to its live miniature. */
    setBoardCover(id: string, attachmentId: string | null): void {
      const fields = ctx.boards.get(id);
      if (!isMap(fields)) return;
      if (attachmentId) fields.set("coverAttachmentId", attachmentId);
      else fields.delete("coverAttachmentId");
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}board-cover`);
    },

    /**
     * A board's labels (ADR-0053 §6).
     * Stored as a set, so two clients adding different tags at once both keep
     * theirs; a whole-list write just diffs the set rather than replacing it.
     */
    setBoardTags(id: string, tagIds: readonly string[]): void {
      const fields = ctx.boards.get(id);
      if (!isMap(fields)) return;
      writeIdSet(fields.ensureMergeableMap("tags"), tagIds);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}board-tags`);
    },

    addBoardTag(id: string, tagId: string): void {
      const board = ctx.api.boards.getBoard(id);
      if (!board || board.tags.includes(tagId)) return;
      const fields = ctx.boards.get(id);
      if (!isMap(fields)) return;
      const tags = fields.ensureMergeableMap("tags");
      if (!tags.get(tagId)) tags.set(tagId, true);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}board-tags`);
    },

    removeBoardTag(id: string, tagId: string): void {
      const fields = ctx.boards.get(id);
      if (!isMap(fields)) return;
      const tags = fields.get("tags");
      if (!isMap(tags) || !tags.get(tagId)) return;
      tags.delete(tagId);
      fields.set("updatedAt", Date.now());
      ctx.commit(`${STRUCT_ORIGIN}board-tags`);
    },

    /**
     * Points a portal card at another board, or at none. This is how a portal whose
     * source board is gone is repaired instead of deleted.
     */
    setPortalTarget(cardId: string, boardId: string | null): void {
      const card = ctx.api.cards.getCard(cardId);
      if (!card || card.deletedAt) return;
      ctx.batch(`${STRUCT_ORIGIN}portal-target`, () => {
        ctx.api.cards.setProperty(cardId, PORTAL_BOARD_FIELD_ID, boardId ?? null);
      });
    },

    deleteBoard(id: string, options: { cards?: "keep" | "trash" } = {}): void {
      const cardsOption = options.cards ?? "keep";
      // Scoped before the placements go: only cards that were on *this* board are
      // candidates for the trash, and only if they have nowhere else to live.
      const onThisBoard = new Set(ctx.api.placements.listBoardCards(id).map((card) => card.id));
      for (const key of [...ctx.placements.keys()]) {
        const fields = ctx.placements.get(key);
        if (isMap(fields) && readString(fields, "boardId") === id) ctx.placements.delete(key);
      }
      for (const edgeId of [...ctx.edges.keys()]) {
        const fields = ctx.edges.get(edgeId);
        if (isMap(fields) && readString(fields, "boardId") === id) ctx.edges.delete(edgeId);
      }
      // Links drawn elsewhere may point at the board itself; they go with it.
      ctx.api.edges.deleteLinksTo({ kind: "board", id });
      for (const sectionId of [...ctx.sections.keys()]) {
        const fields = ctx.sections.get(sectionId);
        if (isMap(fields) && readString(fields, "boardId") === id) ctx.sections.delete(sectionId);
      }
      ctx.boards.delete(id);
      // A portal naming this board would draw an empty frame that opens nothing, so
      // the property is cleared in the same commit: one undo puts the board and its
      // portals back together, and the card survives as a plain card where it sits.
      // A trashed card is left as it is; nothing renders it, and its placement may
      // already be gone.
      for (const card of ctx.api.cards.listCards()) {
        if (card.deletedAt || card.properties[PORTAL_BOARD_FIELD_ID] !== id) continue;
        ctx.api.cards.mutateCard(
          card.id,
          (fields) => {
            const properties = fields.ensureMergeableMap("properties");
            if (properties.get(PORTAL_BOARD_FIELD_ID) !== undefined) {
              properties.delete(PORTAL_BOARD_FIELD_ID);
            }
          },
          false,
        );
      }

      if (cardsOption === "trash") {
        const now = Date.now();
        for (const cardId of onThisBoard) {
          const card = ctx.api.cards.getCard(cardId);
          if (!card || card.deletedAt) continue;
          if (ctx.api.placements.listCardPlacements(cardId).length > 0) continue;
          ctx.api.cards.mutateCard(cardId, (fields) => fields.set("deletedAt", now), false);
        }
      }
      ctx.commit(`${STRUCT_ORIGIN}delete-board`);
    },

    ensureBoard(): Board {
      const [first] = ctx.api.boards.listBoards();
      if (first) return first;
      return ctx.api.boards.createBoard({ id: DEFAULT_BOARD_ID, name: "Board 1" });
    },

    /**
     * Copies a board and everything drawn on it: sections, the cards placed
     * there, their placements and the links between them.
     *
     * Cards are workspace objects, so each one is copied once even when it also
     * sits on other boards — only its placement on the new board is added. Links
     * are board-scoped, so an edge comes along only when both ends are reproduced
     * here; a link whose far end lives elsewhere stays behind with the source.
     *
     * Everything lands in one commit, so a single undo removes the whole board.
     */
    duplicateBoard(sourceId: string, options: DuplicateBoardOptions = {}): Board | null {
      const source = ctx.api.boards.getBoard(sourceId);
      if (!source) return null;

      const requested = options.name?.trim() ?? "";
      const name = requested.length > 0 ? requested : `${source.name} copy`;
      const now = Date.now();

      return ctx.batch(`${STRUCT_ORIGIN}duplicate-board`, () => {
        const board = ctx.api.boards.createBoard({ name });
        if (source.tags.length > 0) ctx.api.boards.setBoardTags(board.id, source.tags);
        // Connector ids are what links name, so copies keep the source layout
        // and every id is minted here, giving the old→new map edges remap with.
        const cardIds = new Map<string, string>();
        const sectionIds = new Map<string, string>();
        const connectorIds = new Map<string, string>();
        const copyConnectors = (connectors: readonly Connector[]): Connector[] =>
          connectors.map((connector) => {
            const id = createConnectorId();
            connectorIds.set(connector.id, id);
            return { id, x: connector.x, y: connector.y };
          });

        for (const section of ctx.api.sections.listSections(sourceId)) {
          const copy = sectionSchema.parse({
            ...section,
            id: crypto.randomUUID(),
            boardId: board.id,
            connectors: copyConnectors(section.connectors ?? []),
            createdAt: now,
            updatedAt: now,
          });
          ctx.api.sections.writeSection(copy);
          sectionIds.set(section.id, copy.id);
        }

        for (const placement of ctx.api.placements.listBoardPlacements(sourceId)) {
          const card = ctx.api.cards.getCard(placement.cardId);
          if (!card || card.deletedAt || cardIds.has(card.id)) continue;
          const copy = ctx.api.cards.duplicateCard(card.id, {
            connectors: copyConnectors(card.connectors),
          });
          cardIds.set(card.id, copy.id);
          const placed = ctx.api.placements.placeCardInternal(board.id, copy.id, {
            x: placement.x,
            y: placement.y,
          });
          if (placed) ctx.api.boards.copyPlacementLayout(board.id, copy.id, placement);
        }

        for (const edge of ctx.api.edges.listBoardEdges(sourceId)) {
          const ends = edgeEndpoints(edge);
          const sourceEnd = ctx.api.boards.remapEndpoint(ends.source, cardIds, sectionIds);
          const targetEnd = ctx.api.boards.remapEndpoint(ends.target, cardIds, sectionIds);
          if (!sourceEnd || !targetEnd) continue;
          const sourceConnector = edge.sourceConnector
            ? connectorIds.get(edge.sourceConnector)
            : undefined;
          const targetConnector = edge.targetConnector
            ? connectorIds.get(edge.targetConnector)
            : undefined;
          // A connector that was not copied would leave a dangling attachment.
          if (edge.sourceConnector && !sourceConnector) continue;
          if (edge.targetConnector && !targetConnector) continue;

          const copy = graphEdgeSchema.parse({
            ...edge,
            id: crypto.randomUUID(),
            boardId: board.id,
            source: sourceEnd.id,
            target: targetEnd.id,
            sourceKind: sourceEnd.kind,
            targetKind: targetEnd.kind,
            ...(sourceConnector ? { sourceConnector } : {}),
            ...(targetConnector ? { targetConnector } : {}),
            createdAt: now,
            updatedAt: now,
          });
          ctx.api.edges.applyEdge(copy);
          // `applyEdge` persists the label but not its offset, which the copy keeps.
          if (copy.labelOffset !== undefined) {
            const fields = ctx.edges.get(copy.id);
            if (isMap(fields)) fields.set("labelOffset", copy.labelOffset);
          }
        }

        return ctx.api.boards.getBoard(board.id) ?? board;
      });
    },

    /** A link endpoint on the copied board, or null when it was not reproduced. */
    remapEndpoint(
      endpoint: LinkEndpoint,
      cardIds: ReadonlyMap<string, string>,
      sectionIds: ReadonlyMap<string, string>,
    ): LinkEndpoint | null {
      if (endpoint.kind === "card") {
        const id = cardIds.get(endpoint.id);
        return id ? { kind: "card", id } : null;
      }
      if (endpoint.kind === "section") {
        const id = sectionIds.get(endpoint.id);
        return id ? { kind: "section", id } : null;
      }
      // Boards are not copied: a board endpoint is drawn through the portal card,
      // which came along, and keeps naming the same board.
      return { kind: "board", id: endpoint.id };
    },

    /** Keeps the copied placement's layer rank and size, computed fresh by `placeCard`. */
    copyPlacementLayout(boardId: string, cardId: string, source: Placement): void {
      const fields = ctx.placements.get(placementKey(boardId, cardId));
      if (!isMap(fields)) return;
      fields.set("z", source.z);
      if (source.width !== undefined) fields.set("width", source.width);
      if (source.height !== undefined) fields.set("height", source.height);
    },
  };
}
