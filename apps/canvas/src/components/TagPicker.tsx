import type { Tag } from "@suite/graph";
import { useMemo, useState } from "react";

export interface TagPickerProps {
  tags: Tag[];
  selectedIds: string[];
  onAdd: (tagId: string) => void;
  onRemove: (tagId: string) => void;
  /** Creates the tag when the typed name is new, then adds it. */
  onCreate: (name: string) => void;
  /** Only the owner may create tags; an editor share assigns existing ones. */
  canCreate?: boolean;
}

export function TagPicker({
  tags,
  selectedIds,
  onAdd,
  onRemove,
  onCreate,
  canCreate = true,
}: TagPickerProps) {
  const [draft, setDraft] = useState("");
  const selected = useMemo(
    () => tags.filter((tag) => selectedIds.includes(tag.id)),
    [tags, selectedIds],
  );
  const needle = draft.trim().toLocaleLowerCase();
  const suggestions = useMemo(() => {
    if (!needle) return [];
    return tags
      .filter(
        (tag) => !selectedIds.includes(tag.id) && tag.name.toLocaleLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [needle, tags, selectedIds]);

  const commit = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = tags.find(
      (tag) => tag.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
    );
    if (existing) onAdd(existing.id);
    else if (canCreate) onCreate(trimmed);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {selected.map((tag) => (
          <span
            key={tag.id}
            data-testid="tag-chip"
            className="flex items-center gap-1 rounded-full bg-[var(--segmented-bg)] px-2 py-0.5 text-[11px] text-[var(--ink)]"
          >
            #{tag.name}
            <button
              type="button"
              aria-label={`Remove tag ${tag.name}`}
              className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
              onClick={() => onRemove(tag.id)}
            >
              {"\u00d7"}
            </button>
          </span>
        ))}
      </div>

      <input
        type="text"
        value={draft}
        data-testid="tag-input"
        placeholder="Add a tag"
        className="w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          }
          if (event.key === "Backspace" && !draft) {
            const last = selected[selected.length - 1];
            if (last) onRemove(last.id);
          }
        }}
        onBlur={() => setDraft("")}
      />

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1" data-testid="tag-suggestions">
          {suggestions.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => commit(tag.name)}
            >
              #{tag.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
