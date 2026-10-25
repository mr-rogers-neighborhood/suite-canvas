import type { Section } from "@suite/graph";
import { sectionColors } from "@suite/graph";
import { SECTION_STROKE } from "../canvas/sectionPalette";
import type { ContainerPanelModel } from "./useContainerPanelModel";

export interface ContainerPanelProps {
  model: ContainerPanelModel;
  onClose: () => void;
  /** A portal's primary action: step through it into the board it opens. */
  onOpenBoard?: ((cardId: string, boardId: string) => void) | undefined;
  onLocate: () => void;
  onSetColor: (color: Section["color"] | null) => void;
  /** Renaming is inline, like a section's title on the canvas. */
  onRename?: ((title: string) => void) | undefined;
}

/**
 * The panel for a container: a portal card or a section.
 *
 * Containers are identities, not cards (ADR-0040): they have no types, no fields
 * and no body, so the card inspector is the wrong surface and this one is
 * deliberately small — what it is, the board it opens, the colour it carries, who
 * is inside it, and the links drawn to it.
 */
export function ContainerPanel({
  model,
  onClose,
  onOpenBoard,
  onLocate,
  onSetColor,
  onRename,
}: ContainerPanelProps) {
  const portal = model.kind === "portal";
  const canEdit = !model.readOnly && model.canEditLayout;

  return (
    <aside
      className="card-inspector container-inspector"
      data-testid="container-inspector"
      data-kind={model.kind}
      aria-label={portal ? "Portal info" : "Section info"}
    >
      <header className="flex items-start gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[13px] font-semibold text-[var(--ink)]"
            title={model.title}
            data-testid="container-title"
          >
            {model.title}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
            {portal ? "Portal" : "Section"}
            {portal && model.board ? " · opens this board" : ""}
            {!portal
              ? ` · ${model.memberTitles.length} card${model.memberTitles.length === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          data-testid="container-close"
          className="rounded px-1.5 py-0.5 text-[13px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          {"\u00d7"}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {portal && model.board && onOpenBoard ? (
            <button
              type="button"
              className="library-action"
              data-testid="container-open-board"
              onClick={() => onOpenBoard(model.id, model.board?.id ?? "")}
            >
              Open board
            </button>
          ) : null}
          <button
            type="button"
            className="library-action"
            data-testid="container-locate"
            onClick={onLocate}
          >
            Locate
          </button>
        </div>

        <section className="mt-3">
          <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
            Colour
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5" data-testid="container-colors">
            {sectionColors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Colour ${color}`}
                aria-pressed={model.color === color}
                disabled={!canEdit}
                data-testid={`container-color-${color}`}
                className="h-5 w-5 rounded-full border border-[var(--hairline)] disabled:opacity-40"
                style={{ background: SECTION_STROKE[color] }}
                onClick={() => onSetColor(model.color === color ? null : color)}
              />
            ))}
          </div>
        </section>

        {portal && model.board ? (
          <section className="mt-3">
            <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
              Board
            </h3>
            <p className="mt-1 text-[12px] text-[var(--ink)]" data-testid="container-board-name">
              {model.board.name}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
              {/* The cover reads from the board record; a picker arrives with the
                  attachment surface, so an unset cover says so instead of hiding. */}
              {model.board.coverAttachmentId ? "Cover set" : "No cover set"}
            </p>
          </section>
        ) : null}

        {!portal && model.memberTitles.length > 0 ? (
          <section className="mt-3">
            <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
              Inside
            </h3>
            <ul className="mt-1 space-y-0.5" data-testid="container-members">
              {model.memberTitles.map((title) => (
                <li
                  key={title || "untitled"}
                  className="truncate text-[12px] text-[var(--ink)]"
                  title={title || "Untitled"}
                >
                  {title || "Untitled"}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-3">
          <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
            Links ({model.links.length})
          </h3>
          {model.links.length === 0 ? (
            <p
              className="mt-1 text-[12px] text-[var(--ink-muted)]"
              data-testid="container-no-links"
            >
              Nothing links here yet.
            </p>
          ) : (
            <ul className="mt-1 space-y-1" data-testid="container-links">
              {model.links.map((link) => (
                <li
                  key={`${link.edgeId}-${link.direction}`}
                  className="flex items-baseline gap-1.5"
                >
                  <span aria-hidden="true" className="text-[11px] text-[var(--ink-muted)]">
                    {link.direction === "in" ? "\u2192" : "\u2190"}
                  </span>
                  <span aria-hidden="true" className="text-[11px] text-[var(--ink-muted)]">
                    {link.glyph}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--ink)]">
                    {link.title}
                    {link.description ? (
                      <span className="ml-1 text-[11px] text-[var(--ink-muted)]">
                        {"\u00b7"} {link.description}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {!portal && onRename && canEdit ? (
          <section className="mt-3">
            <label
              className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]"
              htmlFor="container-rename"
            >
              Title
            </label>
            <input
              id="container-rename"
              data-testid="container-rename"
              className="mt-1 w-full rounded border border-[var(--hairline)] bg-transparent px-1.5 py-1 text-[12px] text-[var(--ink)]"
              defaultValue={model.title}
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next && next !== model.title) onRename(next);
              }}
            />
          </section>
        ) : null}
      </div>
    </aside>
  );
}
