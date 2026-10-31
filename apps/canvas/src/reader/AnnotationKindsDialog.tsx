import type { AnnotationPartTarget, AnnotationStyle, WorkspaceDocument } from "@suite/graph";
import { useEffect, useRef, useState } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import { useEscapeLayer } from "../shell/escapeLayers";

/**
 * The kinds of highlight a workspace has, and what each one produces.
 *
 * This is the only place a mapping is written, and it is deliberately not the raise surface: a mapping is a decision
 * about a *kind* of note — "a Claim gets a Question and a Source" — and a decision about a kind does not belong in the
 * moment of marking one. The raise surface links here instead of growing a second, half-featured copy.
 *
 * A **kind** is what a highlight is; a **type** is what a card is. The two words are never swapped, because the library
 * already has a Types panel and "Types" beside "Types" was the least useful label in the app.
 *
 * Everything below writes through the style setters that already exist. A kind is colour, name, the card type it
 * produces, and the ordered list of slots it fills; the last two are the mapping, and they are what the raise surface
 * turns into rows.
 */
export interface AnnotationKindsDialogProps {
  workspace: WorkspaceDocument;
  onClose: () => void;
}

export function AnnotationKindsDialog({ workspace, onClose }: AnnotationKindsDialogProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(onClose, true);

  // A dialog is about a decision, so it reads the styles once and re-reads after each write rather than subscribing:
  // a peer's rename arriving mid-edit must not rewrite the field under the reader's cursor.
  const [styles, setStyles] = useState<AnnotationStyle[]>(() => workspace.listAnnotationStyles());
  const types = workspace.listTypes();

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button, input, select")?.focus();
  }, []);

  const reread = () => setStyles(workspace.listAnnotationStyles());

  return (
    <div className="ann-kinds-scrim" data-testid="annotation-kinds">
      <button type="button" className="ann-kinds-scrim-hit" aria-label="Close" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Annotation kinds"
        tabIndex={-1}
        className="ann-kinds"
      >
        <header className="ann-kinds-head">
          <span className="ann-kinds-title">Kinds of highlight</span>
          <span className="ann-kinds-sub">What each one becomes</span>
          <button
            type="button"
            className="views-icon-button ml-auto"
            aria-label="Close"
            data-testid="annotation-kinds-close"
            onClick={onClose}
          >
            <IconGlyph icon="lucide:x" size={14} />
          </button>
        </header>

        <ul className="ann-kinds-list">
          {styles.map((style) => (
            <KindRow
              key={style.id}
              style={style}
              types={types.map((type) => ({ id: type.id, name: type.name }))}
              fieldsOf={(typeId) =>
                (types.find((type) => type.id === typeId)?.fields ?? [])
                  .filter((field) => field.kind === "text" || field.kind === "select")
                  .map((field) => field.name)
              }
              onChange={(patch) => {
                workspace.patchAnnotationStyle(style.id, patch);
                reread();
              }}
              onRemove={() => {
                workspace.deleteAnnotationStyle(style.id);
                reread();
              }}
            />
          ))}
        </ul>

        <footer className="ann-kinds-foot">
          <button
            type="button"
            className="views-button"
            data-testid="annotation-kind-add"
            onClick={() => {
              const next = styles.length;
              workspace.addAnnotationStyle({
                name: "New kind",
                color: "#8b93a7",
                order: next,
              });
              reread();
            }}
          >
            <IconGlyph icon="lucide:plus" size={12} />
            Add a kind
          </button>
          <button
            type="button"
            className="views-button views-button--primary"
            data-testid="annotation-kinds-done"
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

interface KindRowProps {
  style: AnnotationStyle;
  types: readonly { id: string; name: string }[];
  fieldsOf: (typeId: string) => string[];
  onChange: (patch: {
    name?: string;
    color?: string;
    templateTypeId?: string | null;
    recipe?: AnnotationPartTarget[] | null;
  }) => void;
  onRemove: () => void;
}

function KindRow({ style, types, fieldsOf, onChange, onRemove }: KindRowProps) {
  const recipe = style.recipe ?? [];
  // The names a slot can point at: the produced type's own properties, plus whatever a slot already names, so a
  // recipe written before the type changed keeps its slots visible rather than silently dropping them.
  const available = [...new Set([...fieldsOf(style.templateTypeId ?? ""), ...slotNames(recipe)])];

  return (
    <li className="ann-type" data-testid={`annotation-kind-${style.id}`}>
      <div className="ann-type-head">
        <input
          type="color"
          className="ann-type-color"
          aria-label={`${style.name} colour`}
          data-testid={`ann-type-color-${style.id}`}
          value={style.color}
          onChange={(event) => onChange({ color: event.target.value })}
        />
        <input
          className="views-input ann-type-name"
          aria-label="Kind name"
          data-testid={`ann-type-name-${style.id}`}
          defaultValue={style.name}
          onBlur={(event) => {
            const name = event.target.value.trim();
            if (name.length > 0 && name !== style.name) onChange({ name });
          }}
        />
        <select
          className="views-input ann-type-target"
          aria-label="The card type this kind makes"
          data-testid={`ann-type-template-${style.id}`}
          value={style.templateTypeId ?? ""}
          onChange={(event) =>
            onChange({
              templateTypeId: event.target.value.length === 0 ? null : event.target.value,
            })
          }
        >
          <option value="">A plain note</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="views-icon-button"
          aria-label={`Remove ${style.name}`}
          data-testid={`ann-type-remove-${style.id}`}
          onClick={onRemove}
        >
          <IconGlyph icon="lucide:trash" size={12} />
        </button>
      </div>

      <div className="ann-type-slots">
        <span className="ann-type-slots-label">Fills</span>
        {recipe.length === 0 ? (
          <span className="ann-type-empty">
            Nothing yet: a highlight of this kind makes a card from the whole passage.
          </span>
        ) : (
          <ul className="ann-type-slot-list">
            {recipe.map((target, index) => (
              <li key={`${String(index)}-${targetKey(target)}`} className="ann-type-slot">
                <select
                  className="views-input ann-type-slot-target"
                  aria-label="Where this slot goes"
                  data-testid={`ann-slot-target-${style.id}-${String(index)}`}
                  value={targetKey(target)}
                  onChange={(event) =>
                    onChange({
                      recipe: replaceAt(recipe, index, parseSlot(event.target.value)),
                    })
                  }
                >
                  <option value="title">The title</option>
                  <option value="body">The passage</option>
                  <option value="own-card">A card of its own</option>
                  {available.map((name) => (
                    <option key={name} value={`field:${name}`}>
                      {name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="views-icon-button"
                  aria-label="Remove this slot"
                  data-testid={`ann-slot-remove-${style.id}-${String(index)}`}
                  onClick={() => onChange({ recipe: recipe.filter((_, at) => at !== index) })}
                >
                  <IconGlyph icon="lucide:x" size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="ann-type-add-slot">
          <button
            type="button"
            className="views-button views-button--quiet"
            data-testid={`ann-slot-add-${style.id}`}
            onClick={() => onChange({ recipe: [...recipe, { kind: "title" }] })}
          >
            Add a slot
          </button>
          {style.templateTypeId === undefined ? null : (
            <button
              type="button"
              className="views-button views-button--quiet"
              title="Take the slots from the card type's own text properties"
              data-testid={`ann-slot-from-type-${style.id}`}
              onClick={() =>
                onChange({
                  recipe: [
                    { kind: "title" },
                    ...fieldsOf(style.templateTypeId ?? "").map(
                      (name) => ({ kind: "field", name }) as AnnotationPartTarget,
                    ),
                  ],
                })
              }
            >
              From the type
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** A target as an option spells it, so the select and the stored value agree. */
function targetKey(target: AnnotationPartTarget): string {
  return target.kind === "field" ? `field:${target.name}` : target.kind;
}

function parseSlot(value: string): AnnotationPartTarget {
  if (value === "title") return { kind: "title" };
  if (value === "own-card") return { kind: "own-card" };
  if (value === "body") return { kind: "body" };
  return { kind: "field", name: value.slice("field:".length) };
}

/** The property names a recipe already names, so a slot survives a type change. */
function slotNames(recipe: readonly AnnotationPartTarget[]): string[] {
  return recipe.flatMap((target) => (target.kind === "field" ? [target.name] : []));
}

function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, at) => (at === index ? next : item));
}
