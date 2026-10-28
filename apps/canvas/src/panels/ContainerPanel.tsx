import type { Section, Tag, Target, WorkspaceDocument } from "@suite/graph";
import { sectionColors } from "@suite/graph";
import { useState } from "react";
import { SECTION_STROKE } from "../canvas/sections/sectionPalette";
import { TagPicker } from "../cards/TagPicker";
import type { InspectorTabId } from "../inspector/capabilities";
import { tabLabel, tabsFor } from "../inspector/capabilities";
import { IconField } from "../inspector/IconField";
import { InspectorTabs } from "../inspector/InspectorTabs";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { BoardCoverPicker } from "../styles/BoardCoverPicker";
import { StyleTab } from "../styles/surface/StyleTab";
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
  /** A section's own icon, or a portal's board icon. Absent hides the row. */
  onSetIcon?: ((icon: string | null) => void) | undefined;
  /** A board's cover image, or null for the live miniature. */
  onSetCover?: ((attachmentId: string | null) => void) | undefined;
  /** Every row that names something makes it the target of a navigation. */
  onNavigate?: ((target: Target) => void) | undefined;
  /** An orphaned portal: point it at a board that still exists. */
  onRetarget?: ((boardId: string) => void) | undefined;
  /** An orphaned portal: take the card off the board it is drawn on. */
  onRemove?: (() => void) | undefined;
  /** Defaults to the live document in the canvas store; tests inject their own. */
  workspace?: WorkspaceDocument | null;
  /** Every tag in the workspace; defaults to the live snapshot. */
  tags?: readonly Tag[] | undefined;
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
  onSetIcon,
  onSetCover,
  onNavigate,
  onRetarget,
  onRemove,
  workspace: workspaceProp = null,
  tags: tagsProp,
}: ContainerPanelProps) {
  const portal = model.kind === "portal";
  const canEdit = !model.readOnly && model.canEditLayout;
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = workspaceProp ?? storeWorkspace;
  const snapshot = useWorkspaceSnapshot();
  const knownTags = tagsProp ?? snapshot.tags;
  const canManageSchema = useUiStore((state) => state.canManageSchema);
  // The picker is a disclosure, not a count: it only exists while the panel is
  // asking which board should replace the one that went away.
  const [picking, setPicking] = useState(false);
  /**
   * The same leaves the card inspector has (ADR-0051): what it is, what it holds, how it
   * is painted. `tabsFor` decides which of them exist — a section has no Style tab,
   * because its paint is the one colour it owns and everything else is the theme.
   */
  const [tab, setTab] = useState<InspectorTabId>("details");
  const kinds = [portal ? "portal" : "section"] as const;
  const tabs = tabsFor(kinds).map((entry) => ({
    id: entry.id,
    label: tabLabel(entry.id, kinds[0]),
  }));
  const details = tab === "details";
  const contentsCount = model.contents.reduce((total, group) => total + group.cards.length, 0);

  // A section is tagged directly; a portal shows the board it opens, and a
  // board's tags belong to that record. Either way a tag is a label: nothing
  // here reads or writes a placement, so tagging can never move a card in or
  // out of a section (ADR-0053 §6).
  const tagTarget: { kind: "section" | "board"; id: string; selected: readonly string[] } | null =
    portal
      ? model.board
        ? { kind: "board", id: model.board.id, selected: model.board.tags }
        : null
      : model.section
        ? { kind: "section", id: model.section.id, selected: model.section.tags }
        : null;

  const addTag = (tagId: string) => {
    if (!tagTarget || !canEdit) return;
    if (tagTarget.kind === "section") workspace.addSectionTag(tagTarget.id, tagId);
    else workspace.addBoardTag(tagTarget.id, tagId);
  };
  const removeTag = (tagId: string) => {
    if (!tagTarget || !canEdit) return;
    if (tagTarget.kind === "section") workspace.removeSectionTag(tagTarget.id, tagId);
    else workspace.removeBoardTag(tagTarget.id, tagId);
  };
  const createTag = (name: string) => {
    if (!tagTarget || !canEdit || !canManageSchema) return;
    const tag = workspace.ensureTag(name);
    addTag(tag.id);
  };

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
              ? ` · ${model.members.length} card${model.members.length === 1 ? "" : "s"}`
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

      <InspectorTabs
        tabs={tabs}
        active={tab}
        ariaLabel="Container sections"
        testId="container-panel-tabs"
        tabTestId={(id) => `container-tab-${id}`}
        idPrefix="container"
        className="card-panel-tabs px-3 pb-1"
        onSelect={setTab}
      />

      {tab === "style" ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5" data-testid="container-style">
          <StyleTab
            targets={[{ kind: "card", id: model.id }]}
            canEdit={canEdit && !model.orphan}
            workspace={workspace}
          />
        </div>
      ) : tab === "content" ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5" data-testid="container-content">
          {portal && model.board ? (
            <section className="mt-3" data-testid="container-contents">
              <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
                {`Contents${contentsCount > 0 ? ` (${contentsCount})` : ""}`}
              </h3>
              {model.contents.length === 0 ? (
                <p
                  className="mt-1 text-[12px] text-[var(--ink-muted)]"
                  data-testid="container-contents-empty"
                >
                  This board has no cards and no sections yet.
                </p>
              ) : (
                <ul className="mt-1 space-y-1.5">
                  {model.contents.map((group) => (
                    <li
                      key={group.sectionId ?? "loose"}
                      data-testid="container-contents-section"
                      data-section-id={group.sectionId ?? ""}
                    >
                      <p className="flex items-baseline gap-1.5">
                        {group.color ? (
                          <span
                            aria-hidden="true"
                            className="inline-block h-2 w-2 flex-none rounded-full"
                            style={{ background: SECTION_STROKE[group.color] }}
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--ink)]">
                          {group.title}
                        </span>
                        <span
                          className="text-[11px] text-[var(--ink-muted)]"
                          data-testid="container-contents-count"
                        >
                          {`${group.cards.length} card${group.cards.length === 1 ? "" : "s"}`}
                        </span>
                      </p>
                      {group.cards.length === 0 ? (
                        <p className="mt-0.5 pl-3.5 text-[11px] text-[var(--ink-muted)]">
                          No cards yet
                        </p>
                      ) : (
                        <ul className="mt-0.5 space-y-0.5 pl-3.5">
                          {group.cards.map((card) => (
                            <li key={card.id}>
                              <button
                                type="button"
                                data-testid="container-contents-card"
                                title={card.title}
                                className="w-full truncate rounded px-1 py-0.5 text-left text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                                onClick={() => onNavigate?.({ kind: "card", id: card.id })}
                              >
                                {card.title}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {!portal ? (
            <section>
              <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
                {`Contents (${model.members.length})`}
              </h3>
              {model.members.length === 0 ? (
                <p
                  className="mt-1 text-[12px] text-[var(--ink-muted)]"
                  data-testid="container-contents-empty"
                >
                  This section is empty.
                </p>
              ) : (
                <ul className="mt-1 space-y-0.5" data-testid="container-members">
                  {model.members.map((member) => (
                    <li key={member.id}>
                      <button
                        type="button"
                        data-testid="container-member-row"
                        title={member.title}
                        className="w-full truncate rounded px-1 py-0.5 text-left text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => onNavigate?.({ kind: "card", id: member.id })}
                      >
                        {member.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5" data-testid="container-details">
          <div className="flex flex-wrap gap-1.5" data-testid="container-actions" hidden={!details}>
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

          {details && portal && model.orphan ? (
            <section className="mt-3" data-testid="container-orphan">
              <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
                {"Empty \u2014 source removed"}
              </h3>
              <p className="mt-1 text-[12px] text-[var(--ink)]">
                The board this portal opened is gone, so there is nothing behind it to show.
              </p>
              {canEdit && onRetarget ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="library-action"
                    data-testid="container-choose-board"
                    aria-expanded={picking}
                    onClick={() => setPicking((open) => !open)}
                  >
                    Choose a board
                  </button>
                  {onRemove ? (
                    <button
                      type="button"
                      className="library-action"
                      data-testid="container-remove-from-board"
                      onClick={onRemove}
                    >
                      Remove from board
                    </button>
                  ) : null}
                </div>
              ) : null}
              {picking && onRetarget ? (
                model.boardOptions.length === 0 ? (
                  <p
                    className="mt-1 text-[12px] text-[var(--ink-muted)]"
                    data-testid="container-board-options-empty"
                  >
                    No other board to choose yet.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-0.5" data-testid="container-board-options">
                    {model.boardOptions.map((board) => (
                      <li key={board.id}>
                        <button
                          type="button"
                          data-testid={`container-board-option-${board.id}`}
                          className="w-full truncate rounded px-1.5 py-1 text-left text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                          onClick={() => {
                            setPicking(false);
                            onRetarget(board.id);
                          }}
                        >
                          {board.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </section>
          ) : null}

          {details && onSetIcon ? (
            <IconField
              value={model.icon}
              canEdit={canEdit}
              testId="container-icon"
              onChange={(icon) => onSetIcon(icon)}
            />
          ) : null}

          {/*
           * A section has its own colour, and it is the one paint a section owns. A portal
           * has none here: it is a card, so its colour is the card's, in Style — the row
           * this replaces wrote the *board's* colour, which is a different record and the
           * reason a portal looked like it had two colour controls.
           */}
          {details && !portal ? (
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
          ) : null}

          {details && tagTarget ? (
            <section className="mt-3" data-testid="container-tags" data-target={tagTarget.kind}>
              <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
                Tags
              </h3>
              {canEdit ? (
                <div className="mt-1">
                  <TagPicker
                    tags={[...knownTags]}
                    selectedIds={[...tagTarget.selected]}
                    onAdd={addTag}
                    onRemove={removeTag}
                    onCreate={createTag}
                    allowCreate={canManageSchema}
                  />
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1" data-testid="container-tag-list">
                  {knownTags
                    .filter((tag) => tagTarget.selected.includes(tag.id))
                    .map((tag) => (
                      <span
                        key={tag.id}
                        data-testid="container-tag-chip"
                        className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[11px] text-[var(--ink)]"
                      >
                        #{tag.name}
                      </span>
                    ))}
                </div>
              )}
            </section>
          ) : null}

          {portal && model.board ? (
            <section className="mt-3">
              <h3 className="text-[11px] font-semibold tracking-wide text-[var(--ink-muted)]">
                Board
              </h3>
              <p className="mt-1 text-[12px] text-[var(--ink)]" data-testid="container-board-name">
                {model.board.name}
              </p>
              <BoardCoverPicker
                boardId={model.board.id}
                coverId={model.board.coverAttachmentId}
                disabled={!canEdit}
                onPick={(attachmentId) => onSetCover?.(attachmentId)}
              />
            </section>
          ) : null}

          {/* A board that is gone has no record to link to, so the list would be
            a permanent "nothing here". */}
          {details && !(portal && model.orphan) ? (
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
                    <li key={`${link.edgeId}-${link.direction}`}>
                      <button
                        type="button"
                        data-testid="container-link-row"
                        className="flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => onNavigate?.({ kind: link.kind, id: link.otherId })}
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
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          {details && !portal && onRename && canEdit ? (
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
      )}
    </aside>
  );
}
