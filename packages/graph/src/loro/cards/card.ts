import type { LoroMap } from "loro-crdt";
import { unique } from "remeda";
import { defaultConnectors } from "../../connectors.js";
import { cardFromMap, normalizeCard } from "../../records/cards.js";
import { copyContainerTree } from "../../records/containers.js";
import { assertPropertyValue, writePropertyValue } from "../../records/propertyValues.js";
import { isList, isMap, isText, readString, writeSurfaceStyle } from "../../records/values.js";
import {
  type Card,
  cardSchema,
  DEFAULT_TYPE_ID,
  type FieldDefinition,
  type Placement,
  type PropertyValue,
} from "../../schema.js";
import type { SurfaceStyle } from "../../style.js";
import { expandTitleTemplate, hasTitleToken, titleTemplateValues } from "../../templateTitle.js";
import {
  CONNECTORS_FIELD,
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  placementKey,
  STRUCT_ORIGIN,
} from "../constants.js";
import type { DocContext } from "../context.js";
import type {
  CardFieldView,
  CreateCardInput,
  CreatePortalCardInput,
  DuplicateCardOptions,
} from "../model.js";

/**
 * Owns the card record itself: create, read, duplicate, move, trash and the type, tag and
 * property writes that make up most of a card's life.
 */

export function cardMethods(ctx: DocContext) {
  return {
    cachedCard(id: string): Card | undefined {
      const cached = ctx.cardCache.get(id);
      if (cached) return cached;
      const value = ctx.cards.get(id);
      if (!isMap(value)) return undefined;
      const card = cardFromMap(id, value);
      ctx.cardCache.set(id, card);
      return card;
    },

    listCards(): Card[] {
      return ctx.cards
        .keys()
        .map((id) => ctx.api.cards.cachedCard(id))
        .filter((card): card is Card => card !== undefined);
    },

    getCard(id: string): Card | undefined {
      return ctx.api.cards.cachedCard(id);
    },

    /** Full write. Prefer the field-level operations below for concurrent edits. */
    setCard(card: Card): void {
      const parsed = cardSchema.parse(normalizeCard(card));
      ctx.api.cards.applyCard(parsed);
      ctx.commit(`${STRUCT_ORIGIN}set-card`);
    },

    applyCard(card: Card): void {
      const fields = ctx.cards.ensureMergeableMap(card.id);
      fields.set("createdAt", card.createdAt);
      fields.set("updatedAt", card.updatedAt);
      fields.set("deletedAt", card.deletedAt ?? null);
      fields.set("primaryTypeId", card.primaryTypeId);

      const types = fields.ensureMergeableMap("types");
      const wantedTypes = new Set(card.typeIds);
      for (const typeId of types.keys()) {
        if (!wantedTypes.has(typeId)) types.delete(typeId);
      }
      for (const typeId of card.typeIds) {
        if (!types.get(typeId)) types.set(typeId, true);
      }

      const tags = fields.ensureMergeableMap("tags");
      const wantedTags = new Set(card.tags);
      for (const tagId of tags.keys()) {
        if (!wantedTags.has(tagId)) tags.delete(tagId);
      }
      for (const tagId of card.tags) {
        if (!tags.get(tagId)) tags.set(tagId, true);
      }

      const properties = fields.ensureMergeableMap("properties");
      const wantedProperties = new Set(Object.keys(card.properties));
      for (const fieldId of properties.keys()) {
        if (!wantedProperties.has(fieldId)) properties.delete(fieldId);
      }
      for (const [fieldId, value] of Object.entries(card.properties)) {
        writePropertyValue(properties, fieldId, ctx.api.cards.fieldForCard(card, fieldId), value);
      }

      const connectors = fields.ensureMergeableMap(CONNECTORS_FIELD);
      const wanted = new Set(card.connectors.map((connector) => connector.id));
      card.connectors.forEach((connector, order) => {
        const connectorFields = connectors.ensureMergeableMap(connector.id);
        connectorFields.set("x", connector.x);
        connectorFields.set("y", connector.y);
        connectorFields.set("order", order);
      });
      for (const connectorId of [...connectors.keys()]) {
        if (!wanted.has(connectorId)) connectors.delete(connectorId);
      }

      // Legacy card shapes wrote a closed kind and an empty data bag.
      if (fields.get("kind") !== undefined) fields.delete("kind");
      if (fields.get("data") !== undefined) fields.delete("data");
    },

    mutateCard(cardId: string, mutate: (fields: LoroMap) => void, commit = true): void {
      const fields = ctx.cards.get(cardId);
      if (!isMap(fields)) return;
      mutate(fields);
      fields.set("updatedAt", Date.now());
      if (commit) ctx.commit(`${STRUCT_ORIGIN}card`);
    },

    createCard(input: CreateCardInput = {}): Card {
      const now = Date.now();
      const typeId = input.typeId ?? DEFAULT_TYPE_ID;
      const template =
        input.fromTemplate === false ? undefined : ctx.api.cards.liveTemplateCard(typeId);
      const card = cardSchema.parse({
        id: input.id ?? crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        connectors: input.connectors ?? template?.connectors ?? defaultConnectors(),
        deletedAt: null,
        typeIds: template ? [...template.typeIds] : [typeId],
        primaryTypeId: typeId,
        tags: template ? [...template.tags] : [],
        properties: template ? structuredClone(template.properties) : {},
      });

      ctx.api.cards.applyCard(card);
      const content = ctx.content.ensureMergeableMap(card.id);
      const title = ctx.titles.ensureMergeableMap(card.id);
      if (template) {
        const sourceContent = ctx.api.cards.peekContent(template.id);
        const sourceTitle = ctx.api.cards.peekTitle(template.id);
        if (sourceContent) copyContainerTree(sourceContent, content);
        if (sourceTitle) copyContainerTree(sourceTitle, title);
        ctx.api.cards.expandCopiedTitle(card, title);
      }
      if (input.boardId) {
        ctx.api.placements.placeCardInternal(
          input.boardId,
          card.id,
          input.position ?? { x: 0, y: 0 },
        );
      }
      ctx.commit(`${STRUCT_ORIGIN}create-card`);
      return card;
    },

    /**
     * The type's template card, if it names one that still exists and is not in
     * the trash. A missing or trashed template is "no template", never an error:
     * a card the user deleted must not break creating cards of that type.
     */
    templateCard(typeId: string): Card | undefined {
      return ctx.api.cards.liveTemplateCard(typeId);
    },

    liveTemplateCard(typeId: string): Card | undefined {
      const templateId = ctx.api.cardTypes.getType(typeId)?.templateCardId;
      if (!templateId) return undefined;
      const template = ctx.api.cards.getCard(templateId);
      return template && !template.deletedAt ? template : undefined;
    },

    /**
     * A copied title is rich text, so mentions and formatting already travel.
     * `{{Field}}` tokens are filled once, here, and only for a plain title: a
     * formatted or mentioned title is left exactly as the template wrote it.
     */
    expandCopiedTitle(card: Card, title: LoroMap): void {
      const children = title.get("children");
      if (!isList(children) || children.length !== 1) return;
      const only = children.get(0);
      if (!isText(only)) return;
      const text: string = only.toString();
      if (!hasTitleToken(text)) return;
      const expanded = expandTitleTemplate(
        text,
        titleTemplateValues(card, ctx.api.cardTypes.listTypes()),
      );
      if (expanded === text) return;
      only.delete(0, only.length);
      if (expanded.length > 0) only.insert(0, expanded);
    },

    /**
     * Creates a portal: a card of the built-in portal type whose board field
     * points at `targetBoardId`, placed on `boardId`.
     *
     * `createCard` and `setProperty` each commit on their own, so the two writes
     * are wrapped in one batch: the portal lands as a single commit and is never
     * observable without its target board.
     */
    createPortalCard(input: CreatePortalCardInput): Card {
      if (!ctx.api.boards.getBoard(input.targetBoardId)) {
        throw new Error(`Unknown board: ${input.targetBoardId}`);
      }
      if (!ctx.api.boards.getBoard(input.boardId)) {
        throw new Error(`Unknown board: ${input.boardId}`);
      }
      const id = input.id ?? crypto.randomUUID();
      ctx.batch(`${STRUCT_ORIGIN}create-portal`, () => {
        // A document that has not been seeded yet still gets a usable portal.
        ctx.api.cardTypes.seedPortalType();
        ctx.api.cards.createCard({
          id,
          typeId: PORTAL_TYPE_ID,
          boardId: input.boardId,
          position: input.position ?? { x: 0, y: 0 },
        });
        ctx.api.cards.setProperty(id, PORTAL_BOARD_FIELD_ID, input.targetBoardId);
        if (input.size) {
          ctx.api.placements.updatePlacementGeometry(input.boardId, id, {
            ...(input.position ?? { x: 0, y: 0 }),
            width: input.size.width,
            height: input.size.height,
          });
        }
      });
      const card = ctx.api.cards.getCard(id);
      if (!card) throw new Error(`Unknown card: ${id}`);
      return card;
    },

    /**
     * Copies a card into a new object with a fresh id. Type, tags, properties and
     * the title/body rich-text trees come along — the containers are deep-copied,
     * marks included — while the original's placements stay behind because they
     * are per-board chrome, not card content. Connectors start fresh unless the
     * caller supplies a layout, which board duplication does so links keep their
     * attachment points. The copy can land on a board, offset from where the
     * source sits there.
     */
    duplicateCard(cardId: string, options: DuplicateCardOptions = {}): Card {
      const source = ctx.api.cards.getCard(cardId);
      if (!source) throw new Error(`Unknown card: ${cardId}`);
      if (source.deletedAt) throw new Error(`Cannot duplicate a trashed card: ${cardId}`);
      if (options.boardId && !ctx.api.boards.getBoard(options.boardId)) {
        throw new Error(`Unknown board: ${options.boardId}`);
      }

      const now = Date.now();
      // `cardSchema.parse` rebuilds every array and record, so the copy shares no
      // mutable structure with the source.
      const card = cardSchema.parse({
        ...source,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        connectors: options.connectors ?? defaultConnectors(),
      });

      return ctx.batch(`${STRUCT_ORIGIN}duplicate-card`, () => {
        ctx.api.cards.applyCard(card);
        const content = ctx.content.ensureMergeableMap(card.id);
        const title = ctx.titles.ensureMergeableMap(card.id);
        const sourceContent = ctx.api.cards.peekContent(cardId);
        const sourceTitle = ctx.api.cards.peekTitle(cardId);
        if (sourceContent) copyContainerTree(sourceContent, content);
        if (sourceTitle) copyContainerTree(sourceTitle, title);

        const boardId = options.boardId;
        if (boardId) {
          // Offset from the source on the target board, else from its home board.
          const origin =
            ctx.api.placements.getPlacement(boardId, cardId) ??
            ctx.api.placements.listCardPlacements(cardId)[0];
          const offset = options.offset ?? { x: 24, y: 24 };
          ctx.api.placements.placeCardInternal(boardId, card.id, {
            x: (origin?.x ?? 0) + offset.x,
            y: (origin?.y ?? 0) + offset.y,
          });
        }
        return card;
      });
    },

    /**
     * Moves a card onto another board by rewriting placements only: the card keeps
     * its identity, title, body, tags and properties, and every placement it held
     * on another board is removed. Without a position it keeps the coordinates it
     * had there (or on its home board).
     *
     * Links are board-scoped and never deleted here. An edge whose other endpoint
     * only lives on the old board goes dormant — `listBoardEdges` stops returning
     * it while the endpoint is elsewhere — and revives when that card returns,
     * exactly like the trash rule. Deleting it instead would lose a link the user
     * can still restore by moving the card back.
     */
    moveCardToBoard(
      cardId: string,
      boardId: string,
      position?: { x: number; y: number },
    ): Placement {
      if (!ctx.api.cards.getCard(cardId)) throw new Error(`Unknown card: ${cardId}`);
      if (!ctx.api.boards.getBoard(boardId)) throw new Error(`Unknown board: ${boardId}`);

      const existing = ctx.api.placements.getPlacement(boardId, cardId);
      const home = ctx.api.placements.listCardPlacements(cardId)[0];
      const target = position ?? {
        x: existing?.x ?? home?.x ?? 0,
        y: existing?.y ?? home?.y ?? 0,
      };
      const others = ctx.api.placements
        .listCardPlacements(cardId)
        .filter((placement) => placement.boardId !== boardId);
      const moved =
        others.length > 0 || !existing || existing.x !== target.x || existing.y !== target.y;
      if (!moved) return existing;

      for (const placement of others) {
        ctx.placements.delete(placementKey(placement.boardId, placement.cardId));
        // A link belongs to the board it was drawn on, and this card has left it: the
        // line can never draw again, and leaving it behind is what made the same pair
        // look doubly connected after a move.
        for (const edge of ctx.api.edges
          .listEdges()
          .filter(
            (entry) =>
              entry.boardId === placement.boardId &&
              (entry.source === cardId || entry.target === cardId),
          )) {
          ctx.edges.delete(edge.id);
        }
      }
      const placed = ctx.api.placements.placeCardInternal(boardId, cardId, target);
      if (!placed) throw new Error(`Cannot place card ${cardId} on board ${boardId}`);
      ctx.commit(`${STRUCT_ORIGIN}move-card-to-board`);
      return placed;
    },

    isTrashed(cardId: string): boolean {
      return Boolean(ctx.api.cards.getCard(cardId)?.deletedAt);
    },

    /**
     * Trashing a card takes its links with it.
     *
     * A link to a card in the trash is not a relationship the reader can see or act
     * on, and keeping it meant a restored card grew a second line every time it was
     * linked again. Restoring brings the card back without them; that is the honest
     * trade, and it is what "delete the links" means.
     */
    trashCard(id: string): void {
      const card = ctx.api.cards.getCard(id);
      if (!card || card.deletedAt) return;
      const edges = ctx.api.edges
        .listEdges()
        .filter((edge) => edge.source === id || edge.target === id);
      // Edges first: the card write commits, and one commit is one undo step, so the
      // card and its lines leave together.
      for (const edge of edges) ctx.edges.delete(edge.id);
      ctx.api.cards.mutateCard(id, (fields) => fields.set("deletedAt", Date.now()));
    },

    restoreCard(id: string): void {
      const card = ctx.api.cards.getCard(id);
      if (!card?.deletedAt) return;
      ctx.api.cards.mutateCard(id, (fields) => fields.set("deletedAt", null));
    },

    purgeCard(id: string): void {
      const placements = ctx.api.placements.listCardPlacements(id);
      const edges = ctx.api.edges
        .listEdges()
        .filter((edge) => edge.source === id || edge.target === id);
      ctx.cards.delete(id);
      for (const placement of placements) {
        ctx.placements.delete(placementKey(placement.boardId, placement.cardId));
      }
      for (const edge of edges) ctx.edges.delete(edge.id);
      ctx.content.delete(id);
      ctx.titles.delete(id);
      ctx.drawings.delete(id);
      // The card's own outgoing refs are derived from content that is gone;
      // other cards keep their dangling ids on purpose.
      ctx.references.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}purge-card`);
    },

    emptyTrash(): void {
      for (const card of ctx.api.cards.listCards()) {
        if (card.deletedAt) ctx.api.cards.purgeCard(card.id);
      }
    },

    cardMemberships(cardId: string, key: "types" | "tags" | "properties"): LoroMap | undefined {
      const fields = ctx.cards.get(cardId);
      if (!isMap(fields)) return undefined;
      const memberships = fields.get(key);
      return isMap(memberships) ? memberships : undefined;
    },

    /**
     * Replaces the whole type membership. The primary type is kept when it is
     * still a member, otherwise the first remaining type becomes primary.
     */
    /** Paint for a card. Absent means the surface role, so dropping it is a reset. */
    setCardStyle(cardId: string, style: SurfaceStyle | null): void {
      ctx.api.cards.mutateCard(cardId, (fields) => writeSurfaceStyle(fields, style));
    },

    /**
     * The card's own icon, which beats its type's. `null` clears it back to
     * inheriting, and `hidden` replaces both with nothing at all — the two
     * decisions a card can make about the icon it was given.
     */
    setCardIcon(cardId: string, icon: string | null, options: { hidden?: boolean } = {}): void {
      ctx.api.cards.mutateCard(cardId, (fields) => {
        if (icon) fields.set("icon", icon);
        else if (fields.get("icon") !== undefined) fields.delete("icon");
        if (options.hidden === true) fields.set("iconHidden", true);
        else if (fields.get("iconHidden") !== undefined) fields.delete("iconHidden");
      });
    },

    setCardTypes(cardId: string, typeIds: string[], primaryTypeId?: string): void {
      const merged = unique(typeIds);
      if (merged.length === 0) {
        throw new Error("A card needs at least one type");
      }
      const primary = primaryTypeId && merged.includes(primaryTypeId) ? primaryTypeId : merged[0];
      if (!primary) return;
      ctx.api.cards.mutateCard(cardId, (fields) => {
        fields.set("primaryTypeId", primary);
        const memberships = fields.ensureMergeableMap("types");
        const wanted = new Set(merged);
        for (const typeId of memberships.keys()) {
          if (!wanted.has(typeId)) memberships.delete(typeId);
        }
        for (const typeId of merged) {
          if (!memberships.get(typeId)) memberships.set(typeId, true);
        }
      });
    },

    addCardType(cardId: string, typeId: string): void {
      const card = ctx.api.cards.getCard(cardId);
      if (!card || card.typeIds.includes(typeId)) return;
      ctx.api.cards.mutateCard(cardId, (fields) => {
        const memberships = fields.ensureMergeableMap("types");
        if (!memberships.get(typeId)) memberships.set(typeId, true);
        if (!readString(fields, "primaryTypeId")) fields.set("primaryTypeId", typeId);
      });
    },

    /** Removing the last type falls back to the built-in note type. */
    removeCardType(cardId: string, typeId: string): void {
      const card = ctx.api.cards.getCard(cardId);
      if (!card?.typeIds.includes(typeId)) return;
      const remaining = card.typeIds.filter((id) => id !== typeId);
      const next = remaining.length > 0 ? remaining : [DEFAULT_TYPE_ID];
      const primary = card.primaryTypeId === typeId ? next[0] : card.primaryTypeId;
      if (!primary) return;
      ctx.api.cards.setCardTypes(cardId, next, primary);
    },

    setPrimaryType(cardId: string, typeId: string): void {
      const card = ctx.api.cards.getCard(cardId);
      if (!card) return;
      const typeIds = card.typeIds.includes(typeId) ? card.typeIds : [typeId, ...card.typeIds];
      ctx.api.cards.setCardTypes(cardId, typeIds, typeId);
    },

    addCardTag(cardId: string, tagId: string): void {
      const card = ctx.api.cards.getCard(cardId);
      if (!card || card.tags.includes(tagId)) return;
      ctx.api.cards.mutateCard(cardId, (fields) => {
        const memberships = fields.ensureMergeableMap("tags");
        if (!memberships.get(tagId)) memberships.set(tagId, true);
      });
    },

    removeCardTag(cardId: string, tagId: string): void {
      const memberships = ctx.api.cards.cardMemberships(cardId, "tags");
      if (!memberships?.get(tagId)) return;
      ctx.api.cards.mutateCard(cardId, (fields) => {
        const tags = fields.ensureMergeableMap("tags");
        if (tags.get(tagId)) tags.delete(tagId);
      });
    },

    /** Fields of the card's types, primary first, then each type's own order. */
    viewCardFields(card: Card): CardFieldView[] {
      const views: CardFieldView[] = [];
      const seen = new Set<string>();
      for (const typeId of card.typeIds) {
        const type = ctx.api.cardTypes.getType(typeId);
        if (!type) continue;
        for (const field of type.fields) {
          if (seen.has(field.id)) continue;
          seen.add(field.id);
          views.push({ typeId, field });
        }
      }
      return views;
    },

    fieldForCard(card: Card, fieldId: string): FieldDefinition | undefined {
      for (const typeId of card.typeIds) {
        const field = ctx.api.cardTypes
          .getType(typeId)
          ?.fields.find((entry) => entry.id === fieldId);
        if (field) return field;
      }
      return undefined;
    },

    /**
     * Writes one property value. `null` clears the key, the same as
     * `clearProperty`, so a picker can commit either gesture with one call.
     */
    setProperty(cardId: string, fieldId: string, value: PropertyValue | null): void {
      const card = ctx.api.cards.getCard(cardId);
      if (!card) throw new Error(`Unknown card: ${cardId}`);
      const field = ctx.api.cards.fieldForCard(card, fieldId);
      if (!field) throw new Error(`Unknown field on this card: ${fieldId}`);
      if (value === null) {
        ctx.api.cards.clearProperty(cardId, fieldId);
        return;
      }
      if (field.kind === "card" && value === cardId) {
        throw new Error(`Field "${field.name}" cannot point at its own card`);
      }
      assertPropertyValue(field, value);
      ctx.api.cards.mutateCard(cardId, (fields) => {
        const properties = fields.ensureMergeableMap("properties");
        writePropertyValue(properties, fieldId, field, value);
      });
    },

    /** Clears the displayed value; the property key disappears from the card. */
    clearProperty(cardId: string, fieldId: string): void {
      const properties = ctx.api.cards.cardMemberships(cardId, "properties");
      if (!properties?.get(fieldId)) return;
      ctx.api.cards.mutateCard(cardId, (fields) => {
        const map = fields.ensureMergeableMap("properties");
        if (map.get(fieldId) !== undefined) map.delete(fieldId);
      });
    },

    listCardsOfType(typeId: string): Card[] {
      if (!ctx.api.cardTypes.getType(typeId)) return [];
      return ctx.api.cards
        .listCards()
        .filter((card) => !card.deletedAt && card.typeIds.includes(typeId));
    },

    listCardsWithTag(tagId: string): Card[] {
      if (!ctx.api.tags.getTag(tagId)) return [];
      return ctx.api.cards
        .listCards()
        .filter((card) => !card.deletedAt && card.tags.includes(tagId));
    },
  };
}
