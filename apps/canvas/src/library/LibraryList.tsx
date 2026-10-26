import type { ReactNode } from "react";
import type { LibraryBoard } from "./libraryTypes";
import { type BoardStarter, TemplateGallery } from "./TemplateGallery";

/** The scrolling list: the template gallery on Boards, the rows, the empty state. */
export function LibraryList({
  tab,
  boardScope,
  searching,
  query,
  filtering,
  entryCount,
  rows,
  templates,
  starters,
  onUseTemplate,
  onUseStarter,
  onEditTemplate,
}: {
  tab: string;
  boardScope: boolean;
  searching: boolean;
  query: string;
  filtering: boolean;
  entryCount: number;
  rows: ReactNode;
  templates: LibraryBoard[];
  starters: readonly BoardStarter[];
  /** Absent when this session may not create boards. */
  onUseTemplate?: ((templateId: string) => void) | undefined;
  onUseStarter: (starterId: string) => void;
  onEditTemplate: (boardId: string) => void;
}) {
  return (
    <div className="library-list overflow-y-auto p-1.5">
      {tab === "boards" && onUseTemplate && templates.length + starters.length > 0 ? (
        <TemplateGallery
          templates={templates}
          starters={starters}
          onUseTemplate={onUseTemplate}
          onUseStarter={onUseStarter}
          onEditTemplate={onEditTemplate}
        />
      ) : null}
      {entryCount === 0 ? (
        <p
          className="px-2 py-6 text-center text-[12px] text-[var(--ink-muted)]"
          {...(searching ? { "data-testid": "library-search-empty" } : {})}
        >
          {emptyLabel({ tab, searching, filtering, boardScope, query })}
        </p>
      ) : (
        rows
      )}
    </div>
  );
}

function emptyLabel({
  tab,
  searching,
  filtering,
  boardScope,
  query,
}: {
  tab: string;
  searching: boolean;
  filtering: boolean;
  boardScope: boolean;
  query: string;
}): string {
  if (tab === "boards") {
    return searching ? `No boards match \u201c${query.trim()}\u201d.` : "No boards yet.";
  }
  if (searching) return `No cards match \u201c${query.trim()}\u201d.`;
  if (filtering) return "No cards match these filters.";
  if (tab === "inbox") return "Nothing in the inbox. Cards you take off a board land here.";
  if (tab === "cards") return boardScope ? "No cards on this board." : "No cards yet.";
  return "Trash is empty.";
}
