import type { CardType, CreateFieldInput, FieldDefinition } from "@suite/graph";
import { fieldKinds, typePluralName } from "@suite/graph";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export interface TypeSettingsDialogProps {
  types: CardType[];
  onClose: () => void;
  onCreateType: (input: { name: string; glyph: string }) => string;
  onUpdateType: (
    id: string,
    patch: { name?: string; pluralName?: string | null; glyph?: string },
  ) => void;
  onDeleteType: (id: string, reassignTo: string) => void;
  onAddField: (typeId: string, input: CreateFieldInput) => void;
  onUpdateField: (
    typeId: string,
    fieldId: string,
    patch: { name?: string; required?: boolean },
  ) => void;
  onRemoveField: (typeId: string, fieldId: string) => void;
  onMoveField: (typeId: string, fieldId: string, toIndex: number) => void;
  onAddOption: (typeId: string, fieldId: string, label: string) => void;
  onUpdateOption: (typeId: string, fieldId: string, optionId: string, label: string) => void;
  onRemoveOption: (typeId: string, fieldId: string, optionId: string) => void;
}

const inputClass =
  "w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]";
const smallButton =
  "rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10";

function FieldOptions({
  typeId,
  field,
  onAdd,
  onUpdate,
  onRemove,
}: {
  typeId: string;
  field: FieldDefinition;
  onAdd: TypeSettingsDialogProps["onAddOption"];
  onUpdate: TypeSettingsDialogProps["onUpdateOption"];
  onRemove: TypeSettingsDialogProps["onRemoveOption"];
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="mt-1.5 space-y-1 border-l border-[var(--hairline)] pl-2">
      {field.options.map((option) => (
        <div key={option.id} className="flex items-center gap-1">
          <input
            type="text"
            defaultValue={option.label}
            aria-label={`Option ${option.label}`}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-[var(--ink)] hover:border-[var(--hairline)] focus:border-[var(--ink-muted)] focus:outline-none"
            onBlur={(event) => {
              const label = event.target.value.trim();
              if (label && label !== option.label) onUpdate(typeId, field.id, option.id, label);
              else event.target.value = option.label;
            }}
          />
          <button
            type="button"
            aria-label={`Remove option ${option.label}`}
            className={smallButton}
            onClick={() => onRemove(typeId, field.id, option.id)}
          >
            {"\u00d7"}
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draft}
          placeholder="New option"
          aria-label={`New option for ${field.name}`}
          className={inputClass}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const label = draft.trim();
            if (label) onAdd(typeId, field.id, label);
            setDraft("");
          }}
        />
      </div>
    </div>
  );
}

export function TypeSettingsDialog({
  types,
  onClose,
  onCreateType,
  onUpdateType,
  onDeleteType,
  onAddField,
  onUpdateField,
  onRemoveField,
  onMoveField,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
}: TypeSettingsDialogProps) {
  const [selectedId, setSelectedId] = useState(types[0]?.id ?? null);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeGlyph, setNewTypeGlyph] = useState("\u25c7");
  const [fieldName, setFieldName] = useState("");
  const [fieldKind, setFieldKind] = useState<CreateFieldInput["kind"]>("text");
  const [fieldOptions, setFieldOptions] = useState("");

  const selected = useMemo(
    () => types.find((type) => type.id === selectedId) ?? types[0],
    [types, selectedId],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const createField = () => {
    if (!selected) return;
    const name = fieldName.trim();
    if (!name) return;
    onAddField(selected.id, {
      name,
      kind: fieldKind,
      ...(fieldKind === "select" || fieldKind === "multiSelect"
        ? {
            options: fieldOptions
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
          }
        : {}),
    });
    setFieldName("");
    setFieldOptions("");
    setFieldKind("text");
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close type settings"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Card types"
        data-testid="type-settings"
        className="relative flex h-[min(560px,calc(100vh-3rem))] w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] shadow-xl"
      >
        <div className="flex w-52 shrink-0 flex-col border-r border-[var(--hairline)]">
          <div className="border-b border-[var(--hairline)] p-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Types
            </p>
            <div className="space-y-0.5">
              {types.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  data-testid={`settings-type-${type.id}`}
                  className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] ${
                    type.id === selected?.id
                      ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
                      : "text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                  }`}
                  onClick={() => setSelectedId(type.id)}
                >
                  <span aria-hidden="true">{type.glyph}</span>
                  <span className="min-w-0 flex-1 truncate">{type.name}</span>
                  <span className="text-[10px] opacity-60">{type.fields.length}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 p-2">
            <div className="flex gap-1">
              <input
                type="text"
                value={newTypeGlyph}
                aria-label="New type glyph"
                className="w-9 rounded-md border border-[var(--hairline)] bg-transparent px-1 py-1 text-center text-[12px]"
                maxLength={2}
                onChange={(event) => setNewTypeGlyph(event.target.value)}
              />
              <input
                type="text"
                value={newTypeName}
                placeholder="New type"
                aria-label="New type name"
                className={inputClass}
                onChange={(event) => setNewTypeName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const name = newTypeName.trim();
                  if (name) setSelectedId(onCreateType({ name, glyph: newTypeGlyph || "\u25c7" }));
                  setNewTypeName("");
                }}
              />
            </div>
            <button
              type="button"
              disabled={!newTypeName.trim()}
              data-testid="create-type"
              className="w-full rounded-md bg-[var(--ink)] px-2 py-1 text-[12px] text-[var(--surface)] disabled:opacity-40"
              onClick={() => {
                const name = newTypeName.trim();
                if (!name) return;
                setSelectedId(onCreateType({ name, glyph: newTypeGlyph || "\u25c7" }));
                setNewTypeName("");
              }}
            >
              Add type
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-[var(--hairline)] px-3 py-2">
            <div className="flex items-center gap-2">
              <input
                key={`${selected?.id}-name`}
                type="text"
                defaultValue={selected?.name ?? ""}
                aria-label="Type name"
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-[var(--ink)] hover:border-[var(--hairline)] focus:border-[var(--ink-muted)] focus:outline-none"
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  if (!selected) return;
                  if (name && name !== selected.name) onUpdateType(selected.id, { name });
                  else event.target.value = selected.name;
                }}
              />
              <button
                type="button"
                className="rounded px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={onClose}
              >
                Done
              </button>
            </div>
            {selected ? (
              <div className="mt-1 flex items-center gap-1.5">
                <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">Plural</span>
                <input
                  key={`${selected.id}-plural`}
                  type="text"
                  defaultValue={selected.pluralName ?? ""}
                  placeholder={typePluralName({ name: selected.name })}
                  aria-label="Type plural name"
                  data-testid="type-plural-name"
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-[var(--ink)] placeholder:text-[var(--ink-muted)] hover:border-[var(--hairline)] focus:border-[var(--ink-muted)] focus:outline-none"
                  onBlur={(event) => {
                    const pluralName = event.target.value.trim();
                    if (pluralName === (selected.pluralName ?? "")) return;
                    onUpdateType(selected.id, { pluralName: pluralName || null });
                  }}
                />
              </div>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {selected ? (
              <>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Fields
                </p>
                <div className="space-y-2" data-testid="field-list">
                  {selected.fields.length === 0 ? (
                    <p className="text-[12px] text-[var(--ink-muted)]">No fields yet.</p>
                  ) : null}
                  {selected.fields.map((field, index) => (
                    <div
                      key={field.id}
                      className="rounded-lg border border-[var(--hairline)] p-2"
                      data-testid={`field-${field.id}`}
                    >
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          defaultValue={field.name}
                          aria-label={`Field name ${field.name}`}
                          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] font-medium text-[var(--ink)] hover:border-[var(--hairline)] focus:border-[var(--ink-muted)] focus:outline-none"
                          onBlur={(event) => {
                            const name = event.target.value.trim();
                            if (name && name !== field.name) {
                              onUpdateField(selected.id, field.id, { name });
                            } else {
                              event.target.value = field.name;
                            }
                          }}
                        />
                        <span className="rounded bg-[var(--segmented-bg)] px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)]">
                          {field.kind}
                        </span>
                        <label className="flex items-center gap-1 text-[10px] text-[var(--ink-muted)]">
                          <input
                            type="checkbox"
                            checked={field.required}
                            aria-label={`Required ${field.name}`}
                            onChange={(event) =>
                              onUpdateField(selected.id, field.id, {
                                required: event.target.checked,
                              })
                            }
                          />
                          req
                        </label>
                        <button
                          type="button"
                          className={smallButton}
                          aria-label={`Move ${field.name} up`}
                          disabled={index === 0}
                          onClick={() => onMoveField(selected.id, field.id, index - 1)}
                        >
                          {"\u2191"}
                        </button>
                        <button
                          type="button"
                          className={smallButton}
                          aria-label={`Move ${field.name} down`}
                          disabled={index === selected.fields.length - 1}
                          onClick={() => onMoveField(selected.id, field.id, index + 1)}
                        >
                          {"\u2193"}
                        </button>
                        <button
                          type="button"
                          className={smallButton}
                          aria-label={`Delete field ${field.name}`}
                          onClick={() => onRemoveField(selected.id, field.id)}
                        >
                          {"\u00d7"}
                        </button>
                      </div>
                      {field.kind === "select" || field.kind === "multiSelect" ? (
                        <FieldOptions
                          typeId={selected.id}
                          field={field}
                          onAdd={onAddOption}
                          onUpdate={onUpdateOption}
                          onRemove={onRemoveOption}
                        />
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="mt-3 space-y-1 rounded-lg border border-dashed border-[var(--hairline)] p-2">
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={fieldName}
                      placeholder="Field name"
                      aria-label="New field name"
                      className={inputClass}
                      onChange={(event) => setFieldName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          createField();
                        }
                      }}
                    />
                    <select
                      value={fieldKind}
                      aria-label="New field kind"
                      className="rounded-md border border-[var(--hairline)] bg-transparent px-1 text-[12px]"
                      onChange={(event) =>
                        setFieldKind(event.target.value as CreateFieldInput["kind"])
                      }
                    >
                      {fieldKinds.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </select>
                  </div>
                  {fieldKind === "select" || fieldKind === "multiSelect" ? (
                    <input
                      type="text"
                      value={fieldOptions}
                      placeholder="Options, comma separated"
                      aria-label="New field options"
                      className={inputClass}
                      onChange={(event) => setFieldOptions(event.target.value)}
                    />
                  ) : null}
                  <button
                    type="button"
                    disabled={!fieldName.trim()}
                    data-testid="create-field"
                    className="w-full rounded-md bg-[var(--ink)] px-2 py-1 text-[12px] text-[var(--surface)] disabled:opacity-40"
                    onClick={createField}
                  >
                    Add field
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[12px] text-[var(--ink-muted)]">Create a type to begin.</p>
            )}
          </div>

          {selected && selected.id !== "note" ? (
            <footer className="border-t border-[var(--hairline)] p-2">
              <button
                type="button"
                data-testid="delete-type"
                className="text-[11px] text-red-600 hover:underline"
                onClick={() => {
                  const fallback =
                    types.find((type) => type.id === "note" && type.id !== selected.id) ??
                    types.find((type) => type.id !== selected.id);
                  if (fallback) onDeleteType(selected.id, fallback.id);
                }}
              >
                Delete type (cards move to{" "}
                {types.find((type) => type.id !== selected.id)?.name ?? "Note"})
              </button>
            </footer>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
