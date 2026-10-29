/**
 * A type's templates, as the type editor shows them.
 *
 * A template is an ordinary card the type copies when it makes a new one (ADR-0038), and a
 * type may hold several. The order is the whole rule: the first is what a plain "new card"
 * arrives written, and the section says so rather than leaving a reader to guess why one row
 * looks different. Everything here writes the same ordered list, so promotion, removal and a
 * card picked by hand are the same operation seen three ways.
 */
export interface TypeTemplatesProps {
  typeId: string;
  typeName: string;
  /** In the type's order; the first is the default. */
  templates: Array<{ id: string; title: string }>;
  /** Cards carrying this type that are not templates yet. */
  candidates: Array<{ id: string; title: string }>;
  onCreate: (typeId: string) => void;
  onOpen: (cardId: string) => void;
  onSet: (typeId: string, cardIds: string[]) => void;
}

const smallButton =
  "rounded px-1.5 py-0.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10";

export function TypeTemplates({
  typeId,
  typeName,
  templates,
  candidates,
  onCreate,
  onOpen,
  onSet,
}: TypeTemplatesProps) {
  const without = (cardId: string) =>
    templates.filter((entry) => entry.id !== cardId).map((entry) => entry.id);

  return (
    <div className="rounded-lg border border-[var(--hairline)] p-2" data-testid="type-template">
      {templates.length === 0 ? (
        <p
          className="text-[11px] leading-4 text-[var(--ink-muted)]"
          data-testid="type-template-empty"
        >
          A new {typeName.toLowerCase()} starts blank. A template gives it a title, a body and
          starting values.
        </p>
      ) : (
        <ul className="space-y-1" data-testid="type-template-list">
          {templates.map((template, index) => (
            <li
              key={template.id}
              className="flex items-center gap-1.5"
              data-testid="type-template-row"
            >
              <span className="min-w-0 flex-1 truncate text-[12px]" title={template.title}>
                {template.title}
              </span>
              {index === 0 ? (
                // The only ordering rule a reader has to know: this is the one a plain "new
                // card" copies, so it is stated rather than implied.
                <span
                  className="shrink-0 rounded bg-[var(--segmented-bg)] px-1 py-0.5 text-[10px] text-[var(--ink-muted)]"
                  data-testid="type-template-default"
                >
                  Used for new cards
                </span>
              ) : (
                <button
                  type="button"
                  className={smallButton}
                  data-testid="type-template-promote"
                  onClick={() => onSet(typeId, [template.id, ...without(template.id)])}
                >
                  Make first
                </button>
              )}
              <button
                type="button"
                className={smallButton}
                data-testid="type-template-open"
                onClick={() => onOpen(template.id)}
              >
                Open
              </button>
              <button
                type="button"
                className={smallButton}
                data-testid="type-template-remove"
                onClick={() => onSet(typeId, without(template.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          className={smallButton}
          data-testid="type-template-create"
          onClick={() => onCreate(typeId)}
        >
          Create one
        </button>
        {/*
          A template does not have to be made here. A reader with a good example already on a
          board wants to say "that one", so the picker sits beside Create and is never
          demanded: a type with no template is a type that starts blank, which is the state
          every type begins in.
        */}
        <select
          data-testid="type-template-pick"
          aria-label={`Add a template card to ${typeName}`}
          className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-1 py-0.5 text-[11px] text-[var(--ink)]"
          value=""
          onChange={(event) => {
            const cardId = event.target.value;
            if (!cardId) return;
            onSet(typeId, [...templates.map((entry) => entry.id), cardId]);
          }}
        >
          <option value="">Use a card that exists&hellip;</option>
          {candidates.map((card) => (
            <option key={card.id} value={card.id}>
              {card.title}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-1.5 text-[10px] leading-4 text-[var(--ink-muted)]">
        The template is a card: edit it like any other, with the slash menu for properties. Use{" "}
        {"{{Field}}"} in a plain title to fill a value in.
      </p>
    </div>
  );
}
