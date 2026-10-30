import { z } from "zod";
import { textNodes } from "./loro/cards/richText.js";
import type { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { ATTACHMENT_NODE_NAME, type PortableNode } from "./portable.js";
import { edgeKindSchema, edgePathSchema, sectionColorSchema } from "./schema.js";

/**
 * Owns what a workspace can start from: the templates themselves, authored as
 * data, the one function that copies one into a document, and the one that
 * reads a live document back into the same shape.
 *
 * A template is data rather than a code path (ADR-0068): it is a description of
 * boards, regions and cards that a test can read and a release can version, and
 * starting from it copies those records through the same typed methods a person
 * would use. Nothing here runs at boot: a workspace picks a template, or it does
 * not, and an empty document stays empty.
 *
 * Records carry stable `key`s so a template can name a card before the document
 * has an id for it: an edge's two ends and a portal's target are keys, and apply
 * maps them to the ids the records it has just written actually have.
 */

/**
 * The most one picture may weigh, decoded. Base64 inflates by a third, so a 2 MB
 * image is ~2.7 MB of JSON in a template row — the number an admin panel shows.
 * Refused at parse time, so an oversized asset fails at read rather than halfway
 * through a write.
 */
export const TEMPLATE_ASSET_MAX_BYTES = 2 * 1024 * 1024;

/** Bytes a base64 string decodes to, without decoding it. */
function base64ByteLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/** One picture, carried inline: the bytes live in the template, not a store. */
const templateAssetSchema = z
  .object({
    /** Stable key a card's `asset` points at. */
    key: z.string().min(1),
    mime: z.string().min(1),
    /** Base64 of the exact bytes. */
    data: z.base64().min(1),
    /** Alt text, as the attachment node carries it. */
    name: z.string().optional(),
    width: z.number().int().nonnegative().optional(),
    height: z.number().int().nonnegative().optional(),
  })
  .superRefine((asset, ctx) => {
    const bytes = base64ByteLength(asset.data);
    if (bytes > TEMPLATE_ASSET_MAX_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `asset "${asset.key}" decodes to ${bytes} bytes; the cap is ${TEMPLATE_ASSET_MAX_BYTES}`,
      });
    }
  });

const templateCardSchema = z.object({
  /** Stable key, unique within the board, so edges can name this card. */
  key: z.string().min(1).optional(),
  /** Becomes the card's title. */
  title: z.string().min(1),
  /** Plain text; each line becomes a paragraph. */
  body: z.string().optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  /** A card type name; a name no type carries falls back to the note type. */
  type: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).optional(),
  /** Makes this card a portal onto another template board, named by its key. */
  portal: z
    .object({
      board: z.string().min(1),
    })
    .optional(),
  /** Key of the template asset this card shows as an attachment in its body. */
  asset: z.string().min(1).optional(),
});

const templateSectionSchema = z.object({
  title: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  color: sectionColorSchema.optional(),
  cards: z.array(templateCardSchema),
});

/** A link between two cards on the same board, named by their keys. */
const templateEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: edgeKindSchema.optional(),
  path: edgePathSchema.optional(),
  bidirectional: z.boolean().optional(),
});

const templateBoardSchema = z.object({
  /** Stable key, unique in the template, so a portal can name this board. */
  key: z.string().min(1).optional(),
  name: z.string().min(1),
  /** A palette swatch id. Templates carry the id, so a restore reads the palette. */
  color: z.string().min(1).max(64).optional(),
  tags: z.array(z.string().min(1)).optional(),
  sections: z.array(templateSectionSchema),
  /** Cards placed on the board but outside any region. */
  cards: z.array(templateCardSchema).optional(),
  /** Links drawn between this board's cards. */
  edges: z.array(templateEdgeSchema).optional(),
});

export type TemplateAsset = z.infer<typeof templateAssetSchema>;
export type TemplateEdge = z.infer<typeof templateEdgeSchema>;
export type TemplateCard = z.infer<typeof templateCardSchema>;
export type TemplateSection = z.infer<typeof templateSectionSchema>;
export type TemplateBoard = z.infer<typeof templateBoardSchema>;

const templateObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** One line for the gallery row: what choosing this produces. */
  description: z.string().min(1),
  /** Bumped when the authored data changes, so a test can pin what it saw. */
  version: z.number().int().positive(),
  /** Pictures the cards show inline, carried as base64 so they need no store. */
  assets: z.array(templateAssetSchema).optional(),
  boards: z.array(templateBoardSchema).min(1),
});

interface LocatedCard {
  card: TemplateCard;
  /** Where this card sits in the data, for a precise parse error. */
  path: Array<string | number>;
}

/** Every card on a board, in the order apply writes them. */
function cardsOf(board: TemplateBoard, boardIndex: number): LocatedCard[] {
  const located: LocatedCard[] = [];
  board.sections.forEach((section, sectionIndex) => {
    section.cards.forEach((card, cardIndex) => {
      located.push({
        card,
        path: ["boards", boardIndex, "sections", sectionIndex, "cards", cardIndex],
      });
    });
  });
  (board.cards ?? []).forEach((card, cardIndex) => {
    located.push({ card, path: ["boards", boardIndex, "cards", cardIndex] });
  });
  return located;
}

/**
 * Parsed through Zod like the rest of a template, so a dangling key fails at
 * read — not in the middle of a write, with half a board already in the document.
 */
export const workspaceTemplateSchema = templateObjectSchema.superRefine((template, ctx) => {
  const boardKeys = new Map<string, number>();
  template.boards.forEach((board, index) => {
    if (board.key === undefined) return;
    const seen = boardKeys.get(board.key);
    if (seen !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `board key "${board.key}" is already used by board ${seen}`,
        path: ["boards", index, "key"],
      });
      return;
    }
    boardKeys.set(board.key, index);
  });

  const assetKeys = new Set<string>();
  (template.assets ?? []).forEach((asset, index) => {
    if (assetKeys.has(asset.key)) {
      ctx.addIssue({
        code: "custom",
        message: `asset key "${asset.key}" is used twice`,
        path: ["assets", index, "key"],
      });
    }
    assetKeys.add(asset.key);
  });

  template.boards.forEach((board, boardIndex) => {
    const cardKeys = new Set<string>();
    for (const { card, path } of cardsOf(board, boardIndex)) {
      if (card.key !== undefined) {
        if (cardKeys.has(card.key)) {
          ctx.addIssue({
            code: "custom",
            message: `card key "${card.key}" is used twice on this board`,
            path: [...path, "key"],
          });
        }
        cardKeys.add(card.key);
      }
      if (card.asset !== undefined && !assetKeys.has(card.asset)) {
        ctx.addIssue({
          code: "custom",
          message: `card "${card.title}" names asset "${card.asset}", which the template does not carry`,
          path: [...path, "asset"],
        });
      }
      if (card.portal !== undefined && !boardKeys.has(card.portal.board)) {
        ctx.addIssue({
          code: "custom",
          message: `portal "${card.title}" points at board key "${card.portal.board}", which the template does not carry`,
          path: [...path, "portal", "board"],
        });
      }
    }

    (board.edges ?? []).forEach((edge, edgeIndex) => {
      for (const end of ["from", "to"] as const) {
        if (!cardKeys.has(edge[end])) {
          ctx.addIssue({
            code: "custom",
            message: `edge ${end} "${edge[end]}" is not a card key on this board`,
            path: ["boards", boardIndex, "edges", edgeIndex, end],
          });
        }
      }
      if (edge.from === edge.to) {
        ctx.addIssue({
          code: "custom",
          message: `edge ${edgeIndex} links "${edge.from}" to itself`,
          path: ["boards", boardIndex, "edges", edgeIndex, "to"],
        });
      }
    });
  });
});

export type WorkspaceTemplate = z.infer<typeof workspaceTemplateSchema>;

/**
 * The two shapes a workspace can start from: the notebook every new workspace
 * opens on, and one demonstration of nested boards.
 *
 * The notebook is deliberately almost empty — a board, one region, and a card of
 * each built-in type saying what that type is for. A first workspace should be a
 * place to write in, not a tour of the features, so the cards are the smallest
 * thing that still shows the difference between a note, a concept and a source.
 *
 * The guide is a placeholder and says so: two portal cards and one labelled link
 * demonstrate the shape nested boards make, and the content is left for whoever
 * builds it in the app and saves it back as a template. Shipping an empty board
 * dressed as a finished reading guide would be the dishonest version of this,
 * so the description calls it unfinished rather than pretending.
 */
export const STARTER_TEMPLATES: readonly WorkspaceTemplate[] = workspaceTemplateSchema
  .array()
  .parse([
    {
      id: "notebook",
      name: "Notebook",
      description: "Notes, concepts and sources",
      version: 1,
      boards: [
        {
          name: "Notebook",
          sections: [
            {
              title: "Start here",
              x: 0,
              y: 0,
              width: 1032,
              height: 352,
              cards: [
                {
                  title: "A note",
                  type: "note",
                  body: "What you noticed, in your own words. Notes hold the raw material the rest of the board is built from.",
                  x: 36,
                  y: 56,
                },
                {
                  title: "A concept",
                  type: "concept",
                  body: "An idea worth naming and reusing. Link it to the notes that support it, and it becomes one of the shapes you think in.",
                  x: 372,
                  y: 56,
                },
                {
                  title: "A source",
                  type: "source",
                  body: "Where a claim came from: a book, a link, a conversation. A source keeps the claim next to its origin.",
                  x: 708,
                  y: 56,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "discworld",
      name: "Discworld Reading Guide",
      description: "An example of nested boards, left unfinished on purpose",
      version: 1,
      boards: [
        {
          key: "guide",
          name: "Discworld Reading Guide",
          sections: [
            {
              title: "Boards",
              x: 0,
              y: 0,
              width: 696,
              height: 352,
              cards: [
                {
                  key: "start",
                  title: "Where to Start",
                  portal: { board: "start" },
                  x: 36,
                  y: 56,
                },
                {
                  key: "themes",
                  title: "Reading by Theme",
                  portal: { board: "themes" },
                  x: 372,
                  y: 56,
                },
              ],
            },
          ],
          edges: [{ from: "start", to: "themes", label: "ready for more" }],
        },
        {
          key: "start",
          name: "Where to Start",
          sections: [],
        },
        {
          key: "themes",
          name: "Reading by Theme",
          sections: [],
        },
      ],
    },
    {
      id: "propagators",
      name: "Propagators",
      description: "Elastic sections and cascading layout reflow",
      version: 2,
      boards: [
        {
          name: "Propagators",
          sections: [
            {
              title: "Exhibit A: 2D Radial Parting",
              color: "blue",
              x: 40,
              y: 40,
              width: 960,
              height: 720,
              cards: [
                {
                  title: "North Card",
                  type: "note",
                  body: "Displaces upward (-Y) when a card is dropped into the center.",
                  x: 356,
                  y: 120,
                },
                {
                  title: "South Card",
                  type: "note",
                  body: "Displaces downward (+Y) when a card is dropped into the center.",
                  x: 356,
                  y: 440,
                },
                {
                  title: "West Card",
                  type: "note",
                  body: "Displaces leftward (-X) when a card is dropped into the center.",
                  x: 140,
                  y: 280,
                },
                {
                  title: "East Card",
                  type: "note",
                  body: "Displaces rightward (+X) when a card is dropped into the center.",
                  x: 572,
                  y: 280,
                },
              ],
            },
            {
              title: "Exhibit B: 4-Way Elastic Membrane",
              color: "green",
              x: 1040,
              y: 40,
              width: 440,
              height: 400,
              cards: [
                {
                  title: "The Piston",
                  type: "concept",
                  body: "Drag me past the top, left, right, or bottom border. The section breathes outward to maintain padding.",
                  x: 1100,
                  y: 140,
                },
              ],
            },
          ],
          cards: [
            {
              title: "The Meteor",
              type: "concept",
              body: "Drag me into Exhibit A and drop me in the center crosshair to disperse the cluster in 4 directions.",
              x: 1520,
              y: 80,
            },
            {
              title: "Stationary Observer",
              type: "source",
              body: "Non-colliding cards experience zero drift during adjacent layout shifts.",
              x: 1520,
              y: 320,
            },
          ],
        },
      ],
    },
  ]);

/** The template with this id, or undefined. */
export function findWorkspaceTemplate(id: string): WorkspaceTemplate | undefined {
  return STARTER_TEMPLATES.find((template) => template.id === id);
}

/** What one template writes, counted from the data so the row cannot drift. */
export function templateSummary(template: WorkspaceTemplate): {
  boards: number;
  sections: number;
  cards: number;
} {
  let sections = 0;
  let cards = 0;
  for (const board of template.boards) {
    sections += board.sections.length;
    cards += board.cards?.length ?? 0;
    for (const section of board.sections) cards += section.cards.length;
  }
  return { boards: template.boards.length, sections, cards };
}

/** The gallery row's second line. */
export function templateDetail(template: WorkspaceTemplate): string {
  const summary = templateSummary(template);
  const sectionWord = summary.sections === 1 ? "section" : "sections";
  const cardWord = summary.cards === 1 ? "card" : "cards";
  return `${summary.sections} ${sectionWord} \u00b7 ${summary.cards} ${cardWord}`;
}

/** `${base} 2`, then `3`, and so on, so a second copy never collides. */
export function templateCopyName(base: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames);
  let index = 2;
  while (taken.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

/** The name itself when it is free, else the numbered fallback. */
export function uniqueBoardName(base: string, existingNames: readonly string[]): string {
  return existingNames.includes(base) ? templateCopyName(base, existingNames) : base;
}

export interface ApplyTemplateOptions {
  /** Origin for the one commit the whole template lands in. */
  origin?: string;
  /**
   * Names the caller already knows are taken. The live board list is checked as
   * well, because a second copy inside one call must not collide with the first.
   */
  takenNames?: readonly string[];
}

/** One picture apply wrote into a card body, and the id its bytes live under. */
export interface TemplateAppliedAsset {
  /** The template's asset key. */
  key: string;
  /**
   * Id the new attachment node carries. The graph layer never holds bytes, so
   * the caller uploads `data` (base64 of the picture) under this id; the node
   * already points at it, and the editor shows a placeholder until it lands.
   */
  attachmentId: string;
  cardId: string;
  mime: string;
  /** The template's own bytes, carried through so the caller need not look them up. */
  data: string;
}

export interface TemplateApplyResult {
  boardIds: string[];
  sectionIds: string[];
  cardIds: string[];
  tagIds: string[];
  edgeIds: string[];
  assets: TemplateAppliedAsset[];
}

function typeIdFor(workspace: WorkspaceDocument, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const needle = name.trim().toLocaleLowerCase();
  return workspace.listTypes().find((type) => type.name.toLocaleLowerCase() === needle)?.id;
}

/** 32 lowercase hex digits: the id shape the relay issues and a projection accepts. */
function newAttachmentId(): string {
  return crypto.randomUUID().replaceAll("-", "").toLowerCase();
}

/** The editor's image node: metadata only, because the bytes live in a store. */
function attachmentNode(asset: TemplateAsset, attachmentId: string): PortableNode {
  return {
    type: ATTACHMENT_NODE_NAME,
    attrs: {
      id: attachmentId,
      mime: asset.mime,
      bytes: base64ByteLength(asset.data),
      ...(asset.name === undefined ? {} : { name: asset.name }),
      ...(asset.width === undefined ? {} : { width: asset.width }),
      ...(asset.height === undefined ? {} : { height: asset.height }),
    },
  };
}

/** A card's body with its picture appended, so the bytes are visible, not a link. */
function bodyWithAsset(
  card: TemplateCard,
  asset: TemplateAsset,
  attachmentId: string,
): PortableNode[] {
  const text = card.body ? textNodes(card.body) : [];
  return [...text, attachmentNode(asset, attachmentId)];
}

/**
 * Copies one template into a workspace, as a single undoable change. Every card,
 * region, link and label goes through the typed document methods, so a template
 * cannot write something the canvas could not have written itself.
 *
 * Records are written in the order their references allow: boards first, so a
 * portal has a target id; cards next, so an edge has two endpoints; portals and
 * edges after every key is mapped; assets last, because a card body is only
 * final once its picture is in it.
 */
export function applyWorkspaceTemplate(
  workspace: WorkspaceDocument,
  source: string | WorkspaceTemplate,
  options: ApplyTemplateOptions = {},
): TemplateApplyResult | null {
  // An object handed straight in is re-parsed for the same reason a string id is
  // looked up first: a dangling key must fail here, before the first write.
  const template =
    typeof source === "string"
      ? findWorkspaceTemplate(source)
      : workspaceTemplateSchema.parse(source);
  if (!template) return null;
  const origin = options.origin ?? `template:${template.id}`;
  const result: TemplateApplyResult = {
    boardIds: [],
    sectionIds: [],
    cardIds: [],
    tagIds: [],
    edgeIds: [],
    assets: [],
  };
  const boardIdByKey = new Map<string, string>();
  const cardIdsByBoard: Array<Map<string, string>> = [];
  const writtenCards: Array<{ card: TemplateCard; cardId: string }> = [];
  const assetByKey = new Map((template.assets ?? []).map((asset) => [asset.key, asset]));

  const tagId = (name: string): string => {
    const tag = workspace.ensureTag(name);
    if (!result.tagIds.includes(tag.id)) result.tagIds.push(tag.id);
    return tag.id;
  };

  const rememberKey = (boardIndex: number, card: TemplateCard, cardId: string): void => {
    if (card.key === undefined) return;
    cardIdsByBoard[boardIndex]?.set(card.key, cardId);
  };

  const writeGeometry = (boardId: string, cardId: string, card: TemplateCard): void => {
    if (card.width === undefined || card.height === undefined) return;
    workspace.updatePlacementGeometry(boardId, cardId, {
      x: card.x,
      y: card.y,
      width: card.width,
      height: card.height,
    });
  };

  const writeCard = (boardId: string, boardIndex: number, card: TemplateCard): void => {
    // A portal is written by the portal pass, once all boards exist. Writing it
    // here as well would leave a plain card beside the portal it becomes.
    if (card.portal !== undefined) return;
    const typeId = typeIdFor(workspace, card.type);
    const created = workspace.createCard({
      boardId,
      position: { x: card.x, y: card.y },
      fromTemplate: false,
      ...(typeId === undefined ? {} : { typeId }),
    });
    workspace.setTitleText(created.id, card.title);
    // A card with a picture has its body written in the asset pass, so the
    // attachment node lands after the text instead of being replaced by it.
    if (card.body && card.asset === undefined) workspace.setBodyText(created.id, card.body);
    for (const tag of card.tags ?? []) workspace.addCardTag(created.id, tagId(tag));
    writeGeometry(boardId, created.id, card);
    result.cardIds.push(created.id);
    writtenCards.push({ card, cardId: created.id });
    rememberKey(boardIndex, card, created.id);
  };

  workspace.batch(origin, () => {
    // 1. Boards, so every board key has an id before anything points at one.
    template.boards.forEach((board, boardIndex) => {
      const name = uniqueBoardName(board.name, [
        ...workspace.listBoards().map((entry) => entry.name),
        ...(options.takenNames ?? []),
      ]);
      const created = workspace.createBoard({ name });
      result.boardIds.push(created.id);
      if (board.key !== undefined) boardIdByKey.set(board.key, created.id);
      cardIdsByBoard[boardIndex] = new Map();
      if (board.color) workspace.setBoardColor(created.id, board.color);
      for (const tag of board.tags ?? []) workspace.addBoardTag(created.id, tagId(tag));
    });

    // 2. Regions and cards, in one batch per board. A nested batch joins the
    // outer one, so the whole template still lands as a single undoable change
    // while each board's records are written together.
    template.boards.forEach((board, boardIndex) => {
      const boardId = result.boardIds[boardIndex];
      if (boardId === undefined) return;
      workspace.batch(origin, () => {
        for (const section of board.sections) {
          const region = workspace.createSection({
            boardId,
            title: section.title,
            x: section.x,
            y: section.y,
            width: section.width,
            height: section.height,
            ...(section.color === undefined ? {} : { color: section.color }),
          });
          result.sectionIds.push(region.id);
          for (const card of section.cards) writeCard(boardId, boardIndex, card);
        }
        for (const card of board.cards ?? []) writeCard(boardId, boardIndex, card);
      });
    });

    // 3. Portals, now that the board they open exists.
    template.boards.forEach((board, boardIndex) => {
      const boardId = result.boardIds[boardIndex];
      if (boardId === undefined) return;
      workspace.batch(origin, () => {
        for (const { card } of cardsOf(board, boardIndex)) {
          const portal = card.portal;
          if (portal === undefined) continue;
          const targetId = boardIdByKey.get(portal.board);
          if (targetId === undefined) continue;
          const created = workspace.createPortalCard({
            boardId,
            targetBoardId: targetId,
            position: { x: card.x, y: card.y },
            ...(card.width === undefined || card.height === undefined
              ? {}
              : { size: { width: card.width, height: card.height } }),
          });
          workspace.setTitleText(created.id, card.title);
          for (const tag of card.tags ?? []) workspace.addCardTag(created.id, tagId(tag));
          result.cardIds.push(created.id);
          writtenCards.push({ card, cardId: created.id });
          rememberKey(boardIndex, card, created.id);
        }
      });
    });

    // 4. Edges, once both endpoints exist on the board they were drawn on.
    template.boards.forEach((board, boardIndex) => {
      const boardId = result.boardIds[boardIndex];
      const keys = cardIdsByBoard[boardIndex];
      if (boardId === undefined || keys === undefined) return;
      workspace.batch(origin, () => {
        for (const edge of board.edges ?? []) {
          const source = keys.get(edge.from);
          const target = keys.get(edge.to);
          if (source === undefined || target === undefined) continue;
          const created = workspace.addEdge({
            boardId,
            source,
            target,
            ...(edge.kind === undefined ? {} : { kind: edge.kind }),
          });
          if (created === null) continue;
          if (edge.path !== undefined) workspace.setEdgePath(created.id, edge.path);
          if (edge.bidirectional) workspace.setEdgeBidirectional(created.id, true);
          if (edge.label !== undefined) workspace.setEdgeLabel(created.id, edge.label);
          result.edgeIds.push(created.id);
        }
      });
    });

    // 5. Pictures last: the body is replaced once, with its text and the node.
    for (const { card, cardId } of writtenCards) {
      if (card.asset === undefined || card.portal !== undefined) continue;
      const asset = assetByKey.get(card.asset);
      if (asset === undefined) continue;
      const attachmentId = newAttachmentId();
      workspace.setBodyNodes(cardId, bodyWithAsset(card, asset, attachmentId));
      result.assets.push({
        key: asset.key,
        attachmentId,
        cardId,
        mime: asset.mime,
        data: asset.data,
      });
    }
  });

  return result;
}
