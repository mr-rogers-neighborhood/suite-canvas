import {
  type Board,
  type Card,
  type CardFieldView,
  type CardType,
  formatPropertyValue,
  type PropertyValue,
} from "@suite/graph";
import type { RefObject } from "react";
import { Section } from "./CardPanelSection";
import type { CardPickerOption } from "./CardPicker";
import { isPropertyEmpty, PropertyField } from "./PropertyField";

/**
 * A board value's reading: the live name when the board exists, otherwise the
 * explicit "missing" state. Other kinds carry no board reading.
 */
function boardReading(
  field: CardFieldView["field"],
  value: PropertyValue | undefined,
  boardNames: Map<string, string>,
): { boardName?: string; boardPresence?: "missing" } {
  if (field.kind !== "board" || typeof value !== "string") return {};
  const name = boardNames.get(value);
  return name ? { boardName: name } : { boardPresence: "missing" };
}

/** Every field of every type, grouped in type order with the primary first. */
export function CardPropertiesSection({
  card,
  fields,
  types,
  cards,
  boards,
  cardTypeIds,
  cardIds,
  focusedField,
  focusedRow,
  editContent,
  manageSchema,
  onSetProperty,
  onClearProperty,
  onManageTypes,
}: {
  card: Card;
  fields: CardFieldView[];
  types: CardType[];
  cards: readonly CardPickerOption[];
  boards: readonly Board[];
  /** The card's types, primary first. */
  cardTypeIds: string[];
  /** Cards this surface knows; a value pointing outside them reads as missing. */
  cardIds: ReadonlySet<string>;
  focusedField: string | null;
  focusedRow: RefObject<HTMLDivElement | null>;
  editContent: boolean;
  manageSchema: boolean;
  onSetProperty: (fieldId: string, value: PropertyValue) => void;
  onClearProperty: (fieldId: string) => void;
  onManageTypes: () => void;
}) {
  const typesById = new Map(types.map((type) => [type.id, type]));
  const boardNames = new Map(boards.map((board) => [board.id, board.name]));
  // Fields union in type order with the primary first (ADR-0053 §2). The order
  // is presentation only: nothing below asks how many types there are.
  const groups: Array<string | null> = cardTypeIds.length > 0 ? cardTypeIds : [null];
  return (
    <Section title="Properties">
      {fields.length === 0 ? (
        <p className="text-[12px] text-[var(--ink-muted)]">
          {cardTypeIds.length > 1
            ? "These types have no fields yet."
            : "This type has no fields yet."}
          {manageSchema ? (
            <>
              {" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-[var(--ink)]"
                onClick={onManageTypes}
              >
                Add one
              </button>
            </>
          ) : null}
        </p>
      ) : (
        <div className="space-y-3" data-testid="property-list">
          {groups.map((typeId) => {
            const group = typeId ? fields.filter((entry) => entry.typeId === typeId) : fields;
            if (group.length === 0) return null;
            // Required is per type and stays advisory (ADR-0053 §3): the
            // badge counts the gaps among *this* type's fields, and
            // nothing below ever refuses a write.
            const required = group.filter((entry) => entry.field.required);
            const missingCount = required.filter((entry) =>
              isPropertyEmpty(card.properties[entry.field.id], entry.field, cardIds),
            ).length;
            // A single type needs no grouping label; two types with a
            // same-named field do, which is the whole point of the label.
            const named = typeId !== null && cardTypeIds.length > 1;
            return (
              <div
                key={typeId ?? "single"}
                className="space-y-2"
                data-testid={`type-group-${typeId ?? "single"}`}
                data-primary={typeId !== null && typeId === card.primaryTypeId ? "true" : undefined}
              >
                {named || required.length > 0 ? (
                  <p
                    className="flex items-center justify-between gap-2 text-[11px] text-[var(--ink-muted)]"
                    data-testid={`type-group-heading-${typeId ?? "single"}`}
                  >
                    <span className="truncate">
                      {named ? (typesById.get(typeId)?.name ?? "Type") : null}
                    </span>
                    {required.length > 0 ? (
                      <span
                        data-testid={`type-required-${typeId ?? "single"}`}
                        data-required={required.length}
                        data-missing={missingCount}
                        title={
                          missingCount === 0
                            ? `All ${required.length} required ${required.length === 1 ? "field" : "fields"} filled`
                            : `${missingCount} of ${required.length} required ${required.length === 1 ? "field is" : "fields are"} empty`
                        }
                        className="shrink-0 tabular-nums"
                      >
                        {missingCount === 0 ? "Complete" : `${missingCount} missing`}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                {group.map(({ field }) => {
                  const value = card.properties[field.id];
                  const missing = field.required && isPropertyEmpty(value, field, cardIds);
                  if (!editContent) {
                    return (
                      <div
                        key={field.id}
                        ref={field.id === focusedField ? focusedRow : undefined}
                        className="property-row block space-y-1"
                        data-focused={field.id === focusedField ? "true" : undefined}
                        data-testid={`property-${field.id}`}
                      >
                        <span className="flex w-full items-center gap-1 text-[11px] text-[var(--ink-muted)]">
                          {field.name}
                        </span>
                        <p
                          className="text-[13px] text-[var(--ink)]"
                          data-testid={`property-value-${field.id}`}
                        >
                          {formatPropertyValue(field, value, {
                            cardTitle:
                              typeof value === "string"
                                ? cards.find((entry) => entry.id === value)?.title
                                : undefined,
                            ...boardReading(field, value, boardNames),
                          })}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={field.id}
                      ref={field.id === focusedField ? focusedRow : undefined}
                      className="property-row block space-y-1"
                      data-focused={field.id === focusedField ? "true" : undefined}
                      data-testid={`property-${field.id}`}
                    >
                      <span className="flex w-full items-center gap-1 text-[11px] text-[var(--ink-muted)]">
                        {field.name}
                        {missing ? (
                          <span
                            title="Required"
                            className="h-1.5 w-1.5 rounded-full bg-[var(--ink-muted)]"
                          />
                        ) : null}
                      </span>
                      <PropertyField
                        field={field}
                        value={value}
                        cards={cards}
                        boards={boards}
                        excludeCardId={card.id}
                        onChange={(next) => onSetProperty(field.id, next)}
                        onClear={() => onClearProperty(field.id)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
