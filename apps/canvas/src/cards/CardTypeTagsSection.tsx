import type { Card, CardType, Tag } from "@suite/graph";
import { Section } from "./CardPanelSection";
import { CardTypePicker } from "./CardTypePicker";
import { TagPicker } from "./TagPicker";

/** The type chips and the tag row, read-only when the surface may not write. */
export function CardTypeTagsSection({
  card,
  types,
  tags,
  cardTypeIds,
  editContent,
  manageSchema,
  onSetType,
  onAddType,
  onRemoveType,
  onManageTypes,
  onAddTag,
  onRemoveTag,
  onCreateTag,
}: {
  card: Card;
  types: CardType[];
  tags: Tag[];
  /** The card's types, primary first. */
  cardTypeIds: string[];
  editContent: boolean;
  manageSchema: boolean;
  onSetType: (typeId: string) => void;
  onAddType: ((typeId: string) => void) | undefined;
  onRemoveType: ((typeId: string) => void) | undefined;
  onManageTypes: () => void;
  onAddTag: (tagId: string) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateTag: (name: string) => void;
}) {
  const typesById = new Map(types.map((type) => [type.id, type]));
  return (
    <>
      <Section title="Type">
        {!manageSchema ? (
          <div className="flex flex-wrap gap-1" data-testid="type-picker" data-readonly="true">
            {cardTypeIds.map((typeId) => {
              const type = typesById.get(typeId);
              if (!type) return null;
              const primary = type.id === card.primaryTypeId;
              return (
                <span
                  key={type.id}
                  data-testid={`type-view-${type.id}`}
                  data-primary={primary ? "true" : undefined}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-[var(--ink)] ${
                    primary
                      ? "border-transparent bg-[var(--segmented-bg)] font-medium"
                      : "border-dashed border-[var(--hairline)]"
                  }`}
                >
                  <span aria-hidden="true">{type.glyph}</span>
                  {type.name}
                </span>
              );
            })}
          </div>
        ) : (
          <CardTypePicker
            card={card}
            types={types}
            orderedIds={cardTypeIds}
            onSetPrimary={onSetType}
            onAdd={onAddType}
            onRemove={onRemoveType}
            onManage={onManageTypes}
          />
        )}
      </Section>

      <Section title="Tags">
        {!editContent ? (
          <div className="flex flex-wrap gap-1" data-testid="tag-list" data-readonly="true">
            {tags
              .filter((tag) => card.tags.includes(tag.id))
              .map((tag) => (
                <span
                  key={tag.id}
                  className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[11px] text-[var(--ink)]"
                >
                  #{tag.name}
                </span>
              ))}
          </div>
        ) : (
          <TagPicker
            tags={tags}
            selectedIds={card.tags}
            onAdd={onAddTag}
            onRemove={onRemoveTag}
            onCreate={onCreateTag}
            allowCreate={manageSchema}
          />
        )}
      </Section>
    </>
  );
}
