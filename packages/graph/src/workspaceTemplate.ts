import { z } from "zod";
import type { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { sectionColorSchema } from "./schema.js";

/**
 * Owns what a workspace can start from: the templates themselves, authored as
 * data, and the one function that copies one into a document.
 *
 * A template is data rather than a code path (ADR-0068): it is a description of
 * boards, regions and cards that a test can read and a release can version, and
 * starting from it copies those records through the same typed methods a person
 * would use. Nothing here runs at boot: a workspace picks a template, or it does
 * not, and an empty document stays empty.
 */

const templateCardSchema = z.object({
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

const templateBoardSchema = z.object({
  name: z.string().min(1),
  color: sectionColorSchema.optional(),
  tags: z.array(z.string().min(1)).optional(),
  sections: z.array(templateSectionSchema),
  /** Cards placed on the board but outside any region. */
  cards: z.array(templateCardSchema).optional(),
});

export const workspaceTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** One line for the gallery row: what choosing this produces. */
  description: z.string().min(1),
  /** Bumped when the authored data changes, so a test can pin what it saw. */
  version: z.number().int().positive(),
  boards: z.array(templateBoardSchema).min(1),
});

export type TemplateCard = z.infer<typeof templateCardSchema>;
export type TemplateSection = z.infer<typeof templateSectionSchema>;
export type TemplateBoard = z.infer<typeof templateBoardSchema>;
export type WorkspaceTemplate = z.infer<typeof workspaceTemplateSchema>;

/**
 * The three shapes the product is actually used for: gathering research,
 * planning a piece of writing, and running a meeting. Geometry is authored, not
 * derived, so a card lands inside its region and membership is true from the
 * stored coordinates alone.
 */
export const STARTER_TEMPLATES: readonly WorkspaceTemplate[] = workspaceTemplateSchema
  .array()
  .parse([
    {
      id: "research",
      name: "Research board",
      description: "Questions, sources and findings",
      version: 1,
      boards: [
        {
          name: "Research board",
          sections: [
            {
              title: "Questions",
              x: 0,
              y: 0,
              width: 360,
              height: 560,
              cards: [
                { title: "What are we trying to learn?", x: 36, y: 56 },
                { title: "Who has looked at this before?", x: 36, y: 296 },
              ],
            },
            {
              title: "Sources",
              x: 392,
              y: 0,
              width: 360,
              height: 560,
              cards: [
                { title: "Reading list", x: 428, y: 56 },
                { title: "People to talk to", x: 428, y: 296 },
              ],
            },
            {
              title: "Findings",
              x: 784,
              y: 0,
              width: 360,
              height: 560,
              cards: [
                { title: "What we know so far", x: 820, y: 56 },
                { title: "Open threads", x: 820, y: 296 },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "outline",
      name: "Outline board",
      description: "Opening, argument and close",
      version: 1,
      boards: [
        {
          name: "Outline board",
          sections: [
            {
              title: "Opening",
              x: 0,
              y: 0,
              width: 360,
              height: 560,
              cards: [
                { title: "The question", x: 36, y: 56 },
                { title: "Why it matters", x: 36, y: 296 },
              ],
            },
            {
              title: "Argument",
              x: 392,
              y: 0,
              width: 360,
              height: 800,
              cards: [
                { title: "Main claim", x: 428, y: 56 },
                { title: "Evidence", x: 428, y: 296 },
                { title: "Counterpoint", x: 428, y: 536 },
              ],
            },
            {
              title: "Close",
              x: 784,
              y: 0,
              width: 360,
              height: 320,
              cards: [{ title: "What changes if we are right", x: 820, y: 56 }],
            },
          ],
        },
      ],
    },
    {
      id: "meeting",
      name: "Meeting board",
      description: "Agenda, notes and actions",
      version: 1,
      boards: [
        {
          name: "Meeting board",
          sections: [
            {
              title: "Agenda",
              x: 0,
              y: 0,
              width: 360,
              height: 560,
              cards: [
                { title: "Decisions we need", x: 36, y: 56 },
                { title: "Open questions", x: 36, y: 296 },
              ],
            },
            {
              title: "Notes",
              x: 392,
              y: 0,
              width: 360,
              height: 320,
              cards: [{ title: "Discussion", x: 428, y: 56 }],
            },
            {
              title: "Actions",
              x: 784,
              y: 0,
              width: 360,
              height: 320,
              cards: [{ title: "Next steps", x: 820, y: 56 }],
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

export interface TemplateApplyResult {
  boardIds: string[];
  sectionIds: string[];
  cardIds: string[];
  tagIds: string[];
}

function typeIdFor(workspace: WorkspaceDocument, name: string | undefined): string | undefined {
  if (!name) return undefined;
  const needle = name.trim().toLocaleLowerCase();
  return workspace.listTypes().find((type) => type.name.toLocaleLowerCase() === needle)?.id;
}

/**
 * Copies one template into a workspace, as a single undoable change. Every card,
 * region and label goes through the typed document methods, so a template cannot
 * write something the canvas could not have written itself.
 */
export function applyWorkspaceTemplate(
  workspace: WorkspaceDocument,
  source: string | WorkspaceTemplate,
  options: ApplyTemplateOptions = {},
): TemplateApplyResult | null {
  const template = typeof source === "string" ? findWorkspaceTemplate(source) : source;
  if (!template) return null;
  const origin = options.origin ?? `template:${template.id}`;
  const result: TemplateApplyResult = { boardIds: [], sectionIds: [], cardIds: [], tagIds: [] };

  const tagId = (name: string): string => {
    const tag = workspace.ensureTag(name);
    if (!result.tagIds.includes(tag.id)) result.tagIds.push(tag.id);
    return tag.id;
  };

  const writeCard = (boardId: string, card: TemplateCard): void => {
    const typeId = typeIdFor(workspace, card.type);
    const created = workspace.createCard({
      boardId,
      position: { x: card.x, y: card.y },
      fromTemplate: false,
      ...(typeId === undefined ? {} : { typeId }),
    });
    workspace.setTitleText(created.id, card.title);
    if (card.body) workspace.setBodyText(created.id, card.body);
    for (const tag of card.tags ?? []) workspace.addCardTag(created.id, tagId(tag));
    if (card.width !== undefined && card.height !== undefined) {
      workspace.updatePlacementGeometry(boardId, created.id, {
        x: card.x,
        y: card.y,
        width: card.width,
        height: card.height,
      });
    }
    result.cardIds.push(created.id);
  };

  workspace.batch(origin, () => {
    for (const board of template.boards) {
      const name = uniqueBoardName(board.name, [
        ...workspace.listBoards().map((entry) => entry.name),
        ...(options.takenNames ?? []),
      ]);
      const created = workspace.createBoard({ name });
      result.boardIds.push(created.id);
      if (board.color) workspace.setBoardColor(created.id, board.color);
      for (const tag of board.tags ?? []) workspace.addBoardTag(created.id, tagId(tag));
      for (const section of board.sections) {
        const region = workspace.createSection({
          boardId: created.id,
          title: section.title,
          x: section.x,
          y: section.y,
          width: section.width,
          height: section.height,
          ...(section.color === undefined ? {} : { color: section.color }),
        });
        result.sectionIds.push(region.id);
        for (const card of section.cards) writeCard(created.id, card);
      }
      for (const card of board.cards ?? []) writeCard(created.id, card);
    }
  });

  return result;
}
