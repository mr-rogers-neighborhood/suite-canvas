import {
  applyWorkspaceTemplate,
  STARTER_TEMPLATES,
  templateCopyName,
  templateDetail,
  uniqueBoardName,
  type WorkspaceDocument,
  type WorkspaceTemplate,
} from "@suite/graph";
import type { LibraryBoard } from "./LibraryDrawer";

/** One shape the gallery offers, read from the template data in `@suite/graph`. */
export interface BoardStarter {
  readonly id: string;
  readonly title: string;
  /** What picking it produces, for the row's second line. */
  readonly detail: string;
}

/**
 * The built-in shapes: the notebook every workspace starts as, and one example of
 * nested boards. The shapes themselves are data in `@suite/graph`, so a test can
 * assert what they hold and a release can version them (ADR-0068: a starter is a
 * copy of authored records, never a code path of its own).
 */
export const BOARD_STARTERS: readonly BoardStarter[] = STARTER_TEMPLATES.map((template) => ({
  id: template.id,
  title: template.name,
  detail: templateDetail(template),
}));

/**
 * Copies one starter into the workspace as a new board, in a single batch, so one
 * undo removes it whole. Takes the template itself as well as its id, because a
 * starter that came from the server has no entry in the bundle to look an id up
 * in. Returns null for an unknown id, which is a programming error rather than a
 * document one: the caller has nothing to open.
 */
export function createStarterBoard(
  workspace: WorkspaceDocument,
  starter: string | WorkspaceTemplate,
  existingNames: readonly string[],
): string | null {
  const id = typeof starter === "string" ? starter : starter.id;
  const applied = applyWorkspaceTemplate(workspace, starter, {
    origin: `template:starter:${id}`,
    takenNames: existingNames,
  });
  return applied?.boardIds[0] ?? null;
}

export { templateCopyName, uniqueBoardName };

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
        <span className="min-w-0 truncate">Start from</span>
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
                    Blueprint {"\u00b7"} {template.cardCount}{" "}
                    {template.cardCount === 1 ? "card" : "cards"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="library-action"
                    aria-label={`Use ${template.title}`}
                    data-testid={`library-template-use-${template.id}`}
                    onClick={() => onUseTemplate(template.id)}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="library-action"
                    aria-label={`Edit ${template.title}`}
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
