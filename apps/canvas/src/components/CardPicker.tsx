import { useId, useMemo, useRef, useState } from "react";

/** The slice of a card a picker needs: an id and the title it searches. */
export interface CardPickerOption {
  id: string;
  title: string;
}

export interface CardPickerProps {
  /** Selectable cards. Titles are searched case-insensitively. */
  cards: readonly CardPickerOption[];
  /** Selected card id. It may point at a card that is gone; that renders unavailable. */
  value?: string | undefined;
  /** Accessible name, usually the field name. */
  label: string;
  onChange: (cardId: string) => void;
  onClear: () => void;
}

const inputClass =
  "w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--ink-muted)]";

/**
 * Search-and-pick over card titles. Deliberately presentational: the caller
 * owns the card list and the write, so the same component serves the card panel
 * and, later, the library.
 */
export function CardPicker({ cards, value, label, onChange, onClear }: CardPickerProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = useMemo(() => cards.find((card) => card.id === value), [cards, value]);
  const needle = draft.trim().toLocaleLowerCase();
  const suggestions = useMemo(() => {
    const matches = needle
      ? cards.filter((card) => card.title.toLocaleLowerCase().includes(needle))
      : cards;
    return matches.slice(0, 6);
  }, [cards, needle]);
  const highlighted = Math.min(active, Math.max(0, suggestions.length - 1));
  const activeCard = suggestions[highlighted] as CardPickerOption | undefined;

  const choose = (card: CardPickerOption) => {
    onChange(card.id);
    setDraft("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const close = () => {
    setDraft("");
    setOpen(false);
  };

  return (
    <div className="space-y-1" data-testid="card-picker">
      {value ? (
        <span className="flex w-fit items-center gap-1 rounded-full bg-[var(--segmented-bg)] px-2 py-0.5 text-[11px] text-[var(--ink)]">
          <span data-testid="card-picker-selected">
            {selected ? selected.title : "Unavailable card"}
          </span>
          <button
            type="button"
            aria-label={`Clear ${label}`}
            className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
            onClick={onClear}
          >
            {"\u00d7"}
          </button>
        </span>
      ) : null}

      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeCard ? `${listId}-${activeCard.id}` : undefined}
        autoComplete="off"
        className={inputClass}
        placeholder={value ? "Replace card" : "Search cards"}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive(Math.min(highlighted + 1, Math.max(0, suggestions.length - 1)));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(Math.max(highlighted - 1, 0));
          }
          if (event.key === "Enter" && activeCard) {
            event.preventDefault();
            choose(activeCard);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
      />

      {open ? (
        suggestions.length > 0 ? (
          <div
            role="listbox"
            id={listId}
            aria-label={`${label} suggestions`}
            className="overflow-hidden rounded-md border border-[var(--hairline)] bg-[var(--surface)] py-0.5"
          >
            {suggestions.map((card, index) => (
              <button
                key={card.id}
                type="button"
                role="option"
                id={`${listId}-${card.id}`}
                aria-selected={index === highlighted}
                data-testid="card-option"
                className={`block w-full truncate px-2 py-1 text-left text-[12px] ${
                  index === highlighted
                    ? "bg-[var(--segmented-bg)] text-[var(--ink)]"
                    : "text-[var(--ink-muted)]"
                }`}
                // Keep the input focused so the click lands before blur closes the list.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(card)}
              >
                {card.title}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[var(--ink-muted)]" data-testid="card-picker-empty">
            No cards match
          </p>
        )
      ) : null}
    </div>
  );
}
