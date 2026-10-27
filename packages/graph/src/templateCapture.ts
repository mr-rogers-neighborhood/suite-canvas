import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID } from "./loro/constants.js";
import type { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { ATTACHMENT_NODE_NAME, loroTreeToJson, type PortableNode } from "./portable.js";
import { DEFAULT_TYPE_ID } from "./schema.js";
import { sectionMembership } from "./sections.js";
import {
  TEMPLATE_ASSET_MAX_BYTES,
  type TemplateAsset,
  type TemplateBoard,
  type TemplateCard,
  type TemplateEdge,
  type TemplateSection,
  type WorkspaceTemplate,
  workspaceTemplateSchema,
} from "./workspaceTemplate.js";

/**
 * Turning a workspace back into a template.
 *
 * The reverse of `applyWorkspaceTemplate`, and the reason the templates in this
 * package are not the only ones that can exist: the person running this product
 * builds a guide on a board, saves it, and it becomes a starter. That means
 * reading a live document into the same authored shape the built-ins use, so a
 * capture and a hand-written template cannot drift into two formats.
 *
 * Pictures are the hard part. A card body stores an attachment node whose
 * attributes are metadata only, and the bytes live in whatever store the caller
 * has, so capture takes a loader. A picture it cannot load is dropped and the
 * card is kept: a template that refuses to save because one image went missing
 * is worse than a template missing one image.
 */

/** Bytes for one attachment id, or null when no store holds them. */
export type TemplateAssetLoader = (
  attachmentId: string,
) => Promise<{ mime: string; bytes: Uint8Array } | null>;

export interface CaptureTemplateOptions {
  /** Template id; defaults to `captured`. */
  id?: string;
  /** Template name; the caller usually asks for one. */
  name?: string;
  description?: string;
  version?: number;
  /**
   * Where the picture bytes come from. The graph layer holds none, so a capture
   * asks the caller's stores. Absent, or a loader that returns null, drops the
   * picture and keeps the card.
   */
  loadAsset?: TemplateAssetLoader;
}

/** Base64 of the exact bytes, so a picture survives a round trip byte for byte. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Every attachment node's attributes, in document order. */
function attachmentAttributes(nodes: readonly PortableNode[]): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  for (const node of nodes) {
    if (node.type === ATTACHMENT_NODE_NAME) found.push(node.attrs ?? {});
    if (node.content) found.push(...attachmentAttributes(node.content));
  }
  return found;
}

function stringAttribute(attrs: Record<string, unknown>, name: string): string | undefined {
  const value = attrs[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberAttribute(attrs: Record<string, unknown>, name: string): number | undefined {
  const value = attrs[name];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Reads a live document into the template shape, which is what makes authoring
 * a starter possible: draw it once, capture it, ship it as data.
 *
 * Every board, region, placed card, portal and card-to-card link is captured;
 * pictures are fetched through `loadAsset` because their bytes live beside the
 * document, and a picture no store holds is dropped while its card is kept. An
 * unplaced (inbox) card has no board to belong to, so it is not captured; a card
 * placed on two boards appears on both, as an independent copy, because a
 * template has no way to say "the same card".
 */
export async function captureWorkspaceTemplate(
  workspace: WorkspaceDocument,
  options: CaptureTemplateOptions = {},
): Promise<WorkspaceTemplate> {
  const boards = workspace.listBoards();
  if (boards.length === 0) {
    throw new Error("Cannot capture a template from an empty workspace: it has no boards");
  }

  const boardKeyById = new Map<string, string>();
  boards.forEach((board, index) => {
    boardKeyById.set(board.id, `board-${index + 1}`);
  });

  const assets: TemplateAsset[] = [];
  const assetKeyByAttachment = new Map<string, string>();

  const captureAsset = async (attrs: Record<string, unknown>): Promise<string | undefined> => {
    const attachmentId = stringAttribute(attrs, "id");
    if (attachmentId === undefined) return undefined;
    const known = assetKeyByAttachment.get(attachmentId);
    if (known !== undefined) return known;
    const loader = options.loadAsset;
    if (loader === undefined) return undefined;
    let bytes: Uint8Array | null = null;
    let loadedMime = "";
    try {
      const loaded = await loader(attachmentId);
      if (loaded !== null) {
        bytes = loaded.bytes;
        loadedMime = loaded.mime;
      }
    } catch {
      // One unreachable store must not lose the whole capture: the picture is
      // dropped and the card stays, which the caller can see in the result.
      bytes = null;
    }
    if (bytes === null || bytes.byteLength === 0) return undefined;
    // The parse-time cap is the law for every template, so a picture over it is
    // dropped here rather than producing a template nothing can read back.
    if (bytes.byteLength > TEMPLATE_ASSET_MAX_BYTES) return undefined;
    const key = `asset-${assets.length + 1}`;
    const mime = stringAttribute(attrs, "mime") ?? loadedMime;
    const name = stringAttribute(attrs, "name");
    const width = numberAttribute(attrs, "width");
    const height = numberAttribute(attrs, "height");
    assets.push({
      key,
      mime: mime.length > 0 ? mime : "application/octet-stream",
      data: bytesToBase64(bytes),
      ...(name === undefined ? {} : { name }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    });
    assetKeyByAttachment.set(attachmentId, key);
    return key;
  };

  const capturedBoards: TemplateBoard[] = [];

  for (const board of boards) {
    const boardKey = boardKeyById.get(board.id) ?? `board-${capturedBoards.length + 1}`;
    const tagNames = (ids: readonly string[]): string[] =>
      ids.flatMap((id) => {
        const tag = workspace.getTag(id);
        return tag ? [tag.name] : [];
      });

    const sections = workspace.listSections(board.id);
    const placements = workspace.listBoardPlacements(board.id);
    const membership = sectionMembership(placements, sections);
    const cardKeyById = new Map<string, string>();
    const cardsBySection = new Map<string, TemplateCard[]>();
    const looseCards: TemplateCard[] = [];

    const captureCard = async (
      placement: (typeof placements)[number],
    ): Promise<TemplateCard | undefined> => {
      const card = workspace.getCard(placement.cardId);
      if (card === undefined || card.deletedAt) return undefined;
      const key = `card-${cardKeyById.size + 1}`;
      cardKeyById.set(card.id, key);
      const captured: TemplateCard = {
        key,
        title: workspace.displayTitle(card.id),
        x: placement.x,
        y: placement.y,
        ...(placement.width === undefined ? {} : { width: placement.width }),
        ...(placement.height === undefined ? {} : { height: placement.height }),
      };
      // A picture contributes no text, so its node leaves a trailing newline;
      // trimming keeps the captured body equal to what apply would write back.
      const body = workspace.cardText(card.id).trim();
      if (body.length > 0) captured.body = body;
      const portalTarget = card.properties[PORTAL_BOARD_FIELD_ID];
      const portalBoardKey =
        typeof portalTarget === "string" ? boardKeyById.get(portalTarget) : undefined;
      if (card.primaryTypeId === PORTAL_TYPE_ID) {
        // A portal whose target is not in the document has nothing to point at,
        // so it comes across as an ordinary card rather than a broken portal.
        if (portalBoardKey !== undefined) captured.portal = { board: portalBoardKey };
      } else if (card.primaryTypeId !== DEFAULT_TYPE_ID) {
        const type = workspace.getType(card.primaryTypeId)?.name;
        if (type !== undefined) captured.type = type;
      }
      const tags = tagNames(card.tags);
      if (tags.length > 0) captured.tags = tags;
      for (const attrs of attachmentAttributes(loroTreeToJson(workspace.peekContent(card.id)))) {
        const asset = await captureAsset(attrs);
        if (asset !== undefined) {
          captured.asset = asset;
          break;
        }
      }
      return captured;
    };

    for (const placement of placements) {
      const captured = await captureCard(placement);
      if (captured === undefined) continue;
      const sectionId = membership.get(placement.cardId);
      if (sectionId === undefined) {
        looseCards.push(captured);
        continue;
      }
      const bucket = cardsBySection.get(sectionId) ?? [];
      bucket.push(captured);
      cardsBySection.set(sectionId, bucket);
    }

    const capturedSections: TemplateSection[] = sections.map((section) => ({
      title: section.title,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
      ...(section.color === undefined ? {} : { color: section.color }),
      cards: cardsBySection.get(section.id) ?? [],
    }));

    const edges: TemplateEdge[] = [];
    for (const edge of workspace.listBoardEdges(board.id)) {
      const source = cardKeyById.get(edge.source);
      const target = cardKeyById.get(edge.target);
      const sourceKind = edge.sourceKind ?? "card";
      const targetKind = edge.targetKind ?? "card";
      if (sourceKind !== "card" || targetKind !== "card") continue;
      if (source === undefined || target === undefined) continue;
      edges.push({
        from: source,
        to: target,
        kind: edge.kind,
        ...(edge.label === undefined || edge.label.length === 0 ? {} : { label: edge.label }),
        ...(edge.path === "bezier" ? {} : { path: edge.path }),
        ...(edge.bidirectional ? { bidirectional: true } : {}),
      });
    }

    const boardTags = tagNames(board.tags);
    const capturedBoard: TemplateBoard = {
      key: boardKey,
      name: board.name,
      sections: capturedSections,
      ...(board.color === undefined ? {} : { color: board.color }),
      ...(boardTags.length > 0 ? { tags: boardTags } : {}),
      ...(looseCards.length > 0 ? { cards: looseCards } : {}),
      ...(edges.length > 0 ? { edges } : {}),
    };
    // A board with neither a region nor a card says nothing, so it is not part
    // of the template; an empty document is then an error rather than a stub.
    const hasContent =
      capturedSections.length > 0 || looseCards.length > 0 || cardsBySection.size > 0;
    if (hasContent) capturedBoards.push(capturedBoard);
  }

  if (capturedBoards.length === 0) {
    throw new Error(
      "Cannot capture a template from an empty workspace: no card is placed on a board",
    );
  }

  // Parsed on the way out, so a capture that produced something unreadable says
  // so here instead of failing when someone applies it.
  return workspaceTemplateSchema.parse({
    id: options.id ?? "captured",
    name: options.name ?? "Captured template",
    description: options.description ?? "Captured from a workspace",
    version: options.version ?? 1,
    ...(assets.length > 0 ? { assets } : {}),
    boards: capturedBoards,
  });
}
