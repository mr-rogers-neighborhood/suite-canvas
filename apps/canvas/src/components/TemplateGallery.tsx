import type { WorkspaceDocument } from "@suite/graph";
import { LoroMap, LoroText } from "loro-crdt";
import type { LibraryBoard } from "./LibraryDrawer";

/** One region of a starter, with the cards it opens holding. */
interface StarterSection {
  readonly title: string;
  readonly cards: readonly string[];
}

/**
 * A starting shape, generated in code the moment someone picks it. It is not a
 * document record: nothing exists until `build` runs, so a workspace that never
 * picks one pays nothing for it (ADR-0040 — templates are duplication).
 */
export interface BoardStarter {
  readonly id: string;
  readonly title: string;
  /** What picking it produces, for the row's second line. */
  readonly detail: string;
  /** Creates the board and its contents; returns the new board's id. */
  readonly build: (workspace: WorkspaceDocument, name: string) => string;
}

/** Column geometry: a card is 288 wide, so it sits inside the region with air. */
const COLUMN_WIDTH = 360;
const COLUMN_GAP = 32;
const CARD_LEFT = 36;
const CARD_TOP = 56;
const CARD_PITCH = 240;

const STARTER_ORIGIN = "template:starter";

/**
 * A plain one-line title, written as rich text.
 *
 * `@suite/graph` exposes the title container but no plain-text writer, and a
 * card with no title reads "Untitled" — which would make a starter board look
 * broken. Everything here rides the caller's batch, so the whole starter is one
 * undo step and never a separate commit.
 */
function writeTitle(workspace: WorkspaceDocument, cardId: string, text: string): void {
  const root = workspace.getTitle(cardId);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  const blocks = root.ensureMergeableList("children");
  const paragraph = blocks.insertContainer(blocks.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  inline.insertContainer(0, new LoroText()).insert(0, text);
}

/**
 * Lays the regions out left to right and fills each one. Card anchors land
 * inside their region's rectangle, which is what makes membership true from the
 * stored coordinates alone (ADR-0017).
 */
function buildBoard(
  workspace: WorkspaceDocument,
  name: string,
  sections: readonly StarterSection[],
): string {
  const board = workspace.createBoard({ name });
  sections.forEach((section, column) => {
    const x = column * (COLUMN_WIDTH + COLUMN_GAP);
    workspace.createSection({
      boardId: board.id,
      title: section.title,
      x,
      y: 0,
      width: COLUMN_WIDTH,
      height: CARD_TOP + Math.max(1, section.cards.length) * CARD_PITCH + 24,
    });
    section.cards.forEach((title, row) => {
      const card = workspace.createCard({
        boardId: board.id,
        position: { x: x + CARD_LEFT, y: CARD_TOP + row * CARD_PITCH },
      });
      writeTitle(workspace, card.id, title);
    });
  });
  return board.id;
}

/** Builds the row's second line from the shape, so it cannot drift. */
function starter(id: string, title: string, sections: readonly StarterSection[]): BoardStarter {
  const cards = sections.reduce((total, section) => total + section.cards.length, 0);
  return {
    id,
    title,
    detail: `${sections.length} sections \u00b7 ${cards} cards`,
    build: (workspace, name) => buildBoard(workspace, name, sections),
  };
}

/**
 * Three shapes the product is actually used for: gathering research, planning a
 * piece of writing, and running a meeting. Each is an ordinary board, so the
 * person can rearrange or delete anything in it.
 */
export const BOARD_STARTERS: readonly BoardStarter[] = [
  starter("research", "Research board", [
    {
      title: "Questions",
      cards: ["What are we trying to learn?", "Who has looked at this before?"],
    },
    { title: "Sources", cards: ["Reading list", "People to talk to"] },
    { title: "Findings", cards: ["What we know so far", "Open threads"] },
  ]),
  starter("outline", "Outline board", [
    { title: "Opening", cards: ["The question", "Why it matters"] },
    { title: "Argument", cards: ["Main claim", "Evidence", "Counterpoint"] },
    { title: "Close", cards: ["What changes if we are right"] },
  ]),
  starter("meeting", "Meeting board", [
    { title: "Agenda", cards: ["Decisions we need", "Open questions"] },
    { title: "Notes", cards: ["Discussion"] },
    { title: "Actions", cards: ["Next steps"] },
  ]),
];

/**
 * `${base} 2`, then `3`, and so on: using a template never lands a second board
 * on a name that is already taken.
 */
export function templateCopyName(base: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames);
  let index = 2;
  while (taken.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

/** The starter's own name when it is free, else the same numbered fallback. */
export function uniqueBoardName(base: string, existingNames: readonly string[]): string {
  if (!existingNames.includes(base)) return base;
  return templateCopyName(base, existingNames);
}

/**
 * Generates one starter as a new board in a single batch, so one undo removes
 * it whole. Returns null for an unknown id, which is a programming error rather
 * than a document one — the caller has nothing to show.
 */
export function createStarterBoard(
  workspace: WorkspaceDocument,
  starterId: string,
  existingNames: readonly string[],
): string | null {
  const starter = BOARD_STARTERS.find((candidate) => candidate.id === starterId);
  if (!starter) return null;
  const name = uniqueBoardName(starter.title, existingNames);
  return workspace.batch(`${STARTER_ORIGIN}:${starter.id}`, () => starter.build(workspace, name));
}

export interface TemplateGalleryProps {
  /** Boards marked as templates, in board order. */
  templates: readonly LibraryBoard[];
  /** Built-in shapes; empty hides the divider and their half of the group. */
  starters?: readonly BoardStarter[];
  /** Copies the template into a new board and opens it. */
  onUseTemplate: (templateId: string) => void;
  /** Generates a starter board and opens it. */
  onUseStarter?: (starterId: string) => void;
  /** Opens the template itself, so it can be changed. */
  onEditTemplate: (templateId: string) => void;
}

/**
 * The Boards tab's Templates group: the workspace's own templates on top, the
 * built-in starters under a divider. Rows are ordinary buttons, so every action
 * is reachable by keyboard and announces what it acts on.
 */
export function TemplateGallery({
  templates,
  starters = [],
  onUseTemplate,
  onUseStarter = () => {},
  onEditTemplate,
}: TemplateGalleryProps) {
  return (
    <section
      className="mb-1"
      aria-labelledby="library-templates-heading"
      data-testid="library-templates"
    >
      <h3 id="library-templates-heading" className="library-group-heading px-1">
        <span className="min-w-0 truncate">Templates</span>
        <span className="tabular-nums">{templates.length + starters.length}</span>
      </h3>

      {templates.length > 0 ? (
        <ul className="space-y-0.5">
          {templates.map((template) => (
            <li key={template.id} className="library-entry" data-row-id={`template:${template.id}`}>
              <div className="library-row" data-testid={`library-template-${template.id}`}>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[12px]"
                    data-testid={`library-template-title-${template.id}`}
                  >
                    {template.title}
                  </p>
                  <p className="truncate text-[10px] text-[var(--ink-muted)]">
                    Template {"\u00b7"} {template.cardCount}{" "}
                    {template.cardCount === 1 ? "card" : "cards"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="library-action"
                    aria-label={`Use template ${template.title}`}
                    data-testid={`library-template-use-${template.id}`}
                    onClick={() => onUseTemplate(template.id)}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="library-action"
                    aria-label={`Edit template ${template.title}`}
                    data-testid={`library-template-edit-${template.id}`}
                    onClick={() => onEditTemplate(template.id)}
                  >
                    Edit
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {starters.length > 0 ? (
        <>
          <div
            className="mx-2 my-1 h-px bg-[var(--hairline)]"
            data-testid="library-templates-divider"
            aria-hidden="true"
          />
          <p className="px-1 pb-0.5 text-[10px] text-[var(--ink-muted)]">Start from a shape</p>
          <ul className="space-y-0.5">
            {starters.map((entry) => (
              <li key={entry.id} className="library-entry" data-row-id={`starter:${entry.id}`}>
                <div className="library-row" data-testid={`library-starter-${entry.id}`}>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[12px]"
                      data-testid={`library-starter-title-${entry.id}`}
                    >
                      {entry.title}
                    </p>
                    <p className="truncate text-[10px] text-[var(--ink-muted)]">{entry.detail}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="library-action"
                      aria-label={`Use starter ${entry.title}`}
                      data-testid={`library-starter-use-${entry.id}`}
                      onClick={() => onUseStarter(entry.id)}
                    >
                      Use
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
