import type { WorkspaceMediaItem } from "@suite/graph";
import { type PointerEvent as ReactPointerEvent, useMemo, useState } from "react";
import { humanBytes } from "../auth/entitlement";
import { attachmentUrl } from "../editor/attachmentNode";
import { useLibraryHold } from "./useLibraryHold";

export interface LibraryMediaListProps {
  items?: WorkspaceMediaItem[];
  onTrash?: ((id: string) => void) | undefined;
  canManage?: boolean;
  /**
   * Places this media as a card of its own and answers with the card it made, so a
   * drag can carry it. Undefined on a surface where content cannot be created.
   */
  onPlaceAsCard?: ((item: WorkspaceMediaItem) => string | undefined) | undefined;
  /** The press that lifts a row into the drag ghost; the drawer owns the ghost. */
  onPressRow?: ((item: WorkspaceMediaItem, event: ReactPointerEvent) => void) | undefined;
  /** A press that never moved opens the card the media lives in. */
  onOpenCard?: ((cardId: string) => void) | undefined;
}

export function LibraryMediaList({
  items = [],
  onTrash,
  canManage = true,
  onPlaceAsCard,
  onPressRow,
  onOpenCard,
}: LibraryMediaListProps) {
  const [filter, setFilter] = useState<"all" | "image" | "video" | "youtube">("all");
  const [query, setQuery] = useState("");

  useLibraryHold({
    onDropAt: () => {
      // The drawer already owns the drop for this gesture; the hook is here for the
      // press it reports and the release it observes, not for a second placement path.
    },
    onOpen: (rowId) => {
      const cardId = items.find((entry) => entry.id === rowId)?.cards[0]?.id;
      if (cardId !== undefined) onOpenCard?.(cardId);
    },
    canPlace: false,
  });

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filter !== "all" && item.kind !== filter) return false;
      if (query.trim()) {
        const needle = query.trim().toLowerCase();
        const nameMatch = item.name?.toLowerCase().includes(needle) ?? false;
        const mimeMatch = item.mime?.toLowerCase().includes(needle) ?? false;
        const idMatch = item.id.toLowerCase().includes(needle);
        const cardMatch = item.cards.some((c) => c.title.toLowerCase().includes(needle));
        if (!nameMatch && !mimeMatch && !idMatch && !cardMatch) return false;
      }
      return true;
    });
  }, [items, filter, query]);

  return (
    <div className="flex h-full flex-col overflow-hidden p-2" data-testid="library-media-list">
      {/* Search and Filters */}
      <div className="flex flex-col gap-2 border-b border-[var(--hairline)] pb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search media by name or card…"
          data-testid="library-media-search"
          className="w-full rounded-lg border border-[var(--hairline)] bg-[var(--surface)] px-2.5 py-1 text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
        />
        <div
          className="flex items-center gap-1 overflow-x-auto text-[11px]"
          data-testid="library-media-filters"
        >
          {(["all", "image", "video", "youtube"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setFilter(kind)}
              data-testid={`media-filter-${kind}`}
              className={`rounded-md px-2 py-0.5 font-medium capitalize transition-colors ${
                filter === kind
                  ? "bg-[var(--ink)] text-[var(--surface)]"
                  : "bg-[var(--surface-muted)] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {kind === "all" ? `All (${items.length})` : kind}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of media items */}
      <div className="flex-1 overflow-y-auto pt-2">
        {filtered.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-center text-[12px] text-[var(--ink-muted)]">
            {items.length === 0 ? "No media in this workspace yet." : "No media match your search."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2" data-testid="library-media-grid">
            {filtered.map((item) => {
              const src = item.url ?? (item.kind !== "youtube" ? attachmentUrl(item.id) : null);
              const thumbSrc =
                item.kind === "youtube" && item.videoId
                  ? `https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`
                  : src;

              return (
                <div
                  key={item.id}
                  data-testid={`media-card-${item.id}`}
                  onPointerDown={(event) => onPressRow?.(item, event)}
                  className="group relative flex cursor-grab flex-col overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1.5 transition-shadow hover:shadow-sm"
                >
                  {/* Thumbnail */}
                  <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded bg-[var(--surface-muted)]">
                    {item.kind === "image" && thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={item.name ?? "Media image"}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : item.kind === "video" && thumbSrc ? (
                      // biome-ignore lint/a11y/useMediaCaption: thumbnail preview
                      <video
                        src={thumbSrc}
                        className="h-full w-full object-cover"
                        preload="metadata"
                      />
                    ) : item.kind === "youtube" && thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={item.name ?? "YouTube video"}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="font-mono text-[11px] font-medium uppercase text-[var(--ink-muted)]">
                        {item.kind}
                      </span>
                    )}

                    {/* Badge in corner */}
                    <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-medium uppercase text-white">
                      {item.kind}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="mt-1 flex flex-1 flex-col justify-between">
                    <div>
                      <div
                        className="truncate text-[11px] font-medium text-[var(--ink)]"
                        title={item.name ?? item.id}
                      >
                        {item.name || "Untitled media"}
                      </div>
                      <div className="flex items-center gap-1 text-[10px] text-[var(--ink-muted)]">
                        {item.bytes ? <span>{humanBytes(item.bytes)}</span> : null}
                        {item.width && item.height ? (
                          <span>
                            {item.width}×{item.height}
                          </span>
                        ) : null}
                      </div>
                      {item.cards.length > 0 ? (
                        <div
                          className="mt-0.5 truncate text-[10px] text-[var(--ink-muted)]"
                          title={item.cards.map((c) => c.title).join(", ")}
                        >
                          Used in {item.cards.length} {item.cards.length === 1 ? "card" : "cards"}
                        </div>
                      ) : null}
                    </div>

                    {/* Actions */}
                    <div className="mt-2 flex items-center justify-between border-t border-[var(--hairline)] pt-1.5">
                      {onPlaceAsCard ? (
                        <button
                          type="button"
                          data-testid={`place-media-${item.id}`}
                          title="Make a card for this media, so you can put it on a board"
                          onClick={() => onPlaceAsCard(item)}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--brand)] hover:bg-[var(--brand)]/10"
                        >
                          Place as card
                        </button>
                      ) : (
                        <span />
                      )}
                      {canManage && onTrash ? (
                        <button
                          type="button"
                          onClick={() => onTrash(item.id)}
                          data-testid={`trash-media-${item.id}`}
                          title="Move to Trash"
                          className="rounded p-1 text-[10px] text-[var(--ink-muted)] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                        >
                          Trash
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
