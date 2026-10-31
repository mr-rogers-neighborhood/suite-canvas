import type { ContainerID, LoroMap } from "loro-crdt";
import type { PortableNode } from "../../portable.js";
import type { Card, Placement, PropertyValue } from "../../schema.js";
import type { SurfaceStyle } from "../../style.js";
import type { DocApi } from "../api.js";
import type {
  CardContainers,
  CardFieldView,
  CreateCardInput,
  CreatePortalCardInput,
  DuplicateCardOptions,
} from "../model.js";

/**
 * The card half of the `WorkspaceDocument` facade: reads and writes of card records,
 * their text containers, types, tags and property values.
 *
 * `WorkspaceDocument` extends this class and passes the card domain that `createDocApi`
 * built over the shared `DocContext`, so the facade keeps one prototype chain and its
 * public methods stay where callers already find them.
 */
export class CardsFacade {
  constructor(protected readonly cardsApi: DocApi["cards"]) {}

  listCards(): Card[] {
    return this.cardsApi.listCards();
  }

  getCard(id: string): Card | undefined {
    return this.cardsApi.getCard(id);
  }

  setCard(card: Card): void {
    this.cardsApi.setCard(card);
  }

  createCard(input: CreateCardInput = {}): Card {
    return this.cardsApi.createCard(input);
  }

  templateCard(typeId: string): Card | undefined {
    return this.cardsApi.templateCard(typeId);
  }

  /** Every template a type offers, in order; the first is what a new card copies. */
  templateCards(typeId: string): Card[] {
    return this.cardsApi.liveTemplateCards(typeId);
  }

  createPortalCard(input: CreatePortalCardInput): Card {
    return this.cardsApi.createPortalCard(input);
  }

  duplicateCard(cardId: string, options: DuplicateCardOptions = {}): Card {
    return this.cardsApi.duplicateCard(cardId, options);
  }

  moveCardToBoard(cardId: string, boardId: string, position?: { x: number; y: number }): Placement {
    return this.cardsApi.moveCardToBoard(cardId, boardId, position);
  }

  /** Places a card on another board and leaves its other placements alone. */
  alsoPlaceCardOnBoard(
    cardId: string,
    boardId: string,
    position?: { x: number; y: number },
  ): Placement {
    return this.cardsApi.alsoPlaceCardOnBoard(cardId, boardId, position);
  }

  isTrashed(cardId: string): boolean {
    return this.cardsApi.isTrashed(cardId);
  }

  trashCard(id: string): void {
    this.cardsApi.trashCard(id);
  }

  restoreCard(id: string): void {
    this.cardsApi.restoreCard(id);
  }

  purgeCard(id: string): void {
    this.cardsApi.purgeCard(id);
  }

  emptyTrash(): void {
    this.cardsApi.emptyTrash();
  }

  peekContent(cardId: string): LoroMap | null {
    return this.cardsApi.peekContent(cardId);
  }

  peekTitle(cardId: string): LoroMap | null {
    return this.cardsApi.peekTitle(cardId);
  }

  getContent(cardId: string): LoroMap {
    return this.cardsApi.getContent(cardId);
  }

  getTitle(cardId: string): LoroMap {
    return this.cardsApi.getTitle(cardId);
  }

  contentId(cardId: string): ContainerID | null {
    return this.cardsApi.contentId(cardId);
  }

  titleId(cardId: string): ContainerID | null {
    return this.cardsApi.titleId(cardId);
  }

  hasTitle(cardId: string): boolean {
    return this.cardsApi.hasTitle(cardId);
  }

  cardContainers(cardId: string): CardContainers {
    return this.cardsApi.cardContainers(cardId);
  }

  observeContainers(cardId: string, listener: () => void): () => void {
    return this.cardsApi.observeContainers(cardId, listener);
  }

  observeTitle(cardId: string, listener: () => void): () => void {
    return this.cardsApi.observeTitle(cardId, listener);
  }

  displayTitle(cardId: string): string {
    return this.cardsApi.displayTitle(cardId);
  }

  referencesFor(cardId: string): string[] {
    return this.cardsApi.referencesFor(cardId);
  }

  listReferences(): Record<string, string[]> {
    return this.cardsApi.listReferences();
  }

  cardText(cardId: string): string {
    return this.cardsApi.cardText(cardId);
  }

  bodyPropertyBlocks(cardId: string): string[] {
    return this.cardsApi.bodyPropertyBlocks(cardId);
  }

  appendPropertyBlock(cardId: string, fieldId: string): boolean {
    return this.cardsApi.appendPropertyBlock(cardId, fieldId);
  }

  removePropertyBlock(cardId: string, fieldId: string): boolean {
    return this.cardsApi.removePropertyBlock(cardId, fieldId);
  }

  setTitleNodes(cardId: string, nodes: readonly PortableNode[]): boolean {
    return this.cardsApi.setTitleNodes(cardId, nodes);
  }

  setBodyNodes(cardId: string, nodes: readonly PortableNode[]): boolean {
    return this.cardsApi.setBodyNodes(cardId, nodes);
  }

  setTitleText(cardId: string, title: string): boolean {
    return this.cardsApi.setTitleText(cardId, title);
  }

  setBodyText(cardId: string, body: string): boolean {
    return this.cardsApi.setBodyText(cardId, body);
  }

  ensureReferences(): number {
    return this.cardsApi.ensureReferences();
  }

  rebuildReferences(): number {
    return this.cardsApi.rebuildReferences();
  }

  setCardStyle(cardId: string, style: SurfaceStyle | null): void {
    this.cardsApi.setCardStyle(cardId, style);
  }

  setCardIcon(cardId: string, icon: string | null, options: { hidden?: boolean } = {}): void {
    this.cardsApi.setCardIcon(cardId, icon, options);
  }

  setCardTypes(cardId: string, typeIds: string[], primaryTypeId?: string): void {
    this.cardsApi.setCardTypes(cardId, typeIds, primaryTypeId);
  }

  addCardType(cardId: string, typeId: string): void {
    this.cardsApi.addCardType(cardId, typeId);
  }

  removeCardType(cardId: string, typeId: string): void {
    this.cardsApi.removeCardType(cardId, typeId);
  }

  setPrimaryType(cardId: string, typeId: string): void {
    this.cardsApi.setPrimaryType(cardId, typeId);
  }

  addCardTag(cardId: string, tagId: string): void {
    this.cardsApi.addCardTag(cardId, tagId);
  }

  removeCardTag(cardId: string, tagId: string): void {
    this.cardsApi.removeCardTag(cardId, tagId);
  }

  viewCardFields(card: Card): CardFieldView[] {
    return this.cardsApi.viewCardFields(card);
  }

  setProperty(cardId: string, fieldId: string, value: PropertyValue | null): void {
    this.cardsApi.setProperty(cardId, fieldId, value);
  }

  clearProperty(cardId: string, fieldId: string): void {
    this.cardsApi.clearProperty(cardId, fieldId);
  }

  listCardsOfType(typeId: string): Card[] {
    return this.cardsApi.listCardsOfType(typeId);
  }

  listCardsWithTag(tagId: string): Card[] {
    return this.cardsApi.listCardsWithTag(tagId);
  }
}
