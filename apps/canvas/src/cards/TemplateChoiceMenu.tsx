import { useEscapeLayer } from "../shell/escapeLayers";

/** What the menu was opened for: which type, and where on the board the card lands. */
export interface TemplateChoice {
  typeId: string;
  typeName: string;
  /** Templates in the type's order, with the first one the default. */
  templates: Array<{ id: string; title: string }>;
  point?: { x: number; y: number } | undefined;
}

/**
 * The one place a reader picks which template a new card starts from.
 *
 * A type with two or more templates cannot answer "what does a new card look like" on its own,
 * and asking in four places (dock, palette, library, card type picker) is how four different
 * answers appear. Every surface calls the same `createCard`, which opens this when — and only
 * when — there is a real choice to make.
 *
 * Blank is always offered. The menu is where a template is chosen, never where having one is
 * made mandatory.
 */
export function TemplateChoiceMenu({
  choice,
  onPick,
  onClose,
}: {
  choice: TemplateChoice;
  onPick: (templateId: string | null) => void;
  onClose: () => void;
}) {
  useEscapeLayer(onClose);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close template choice"
        className="absolute inset-0 cursor-default border-0 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        role="menu"
        aria-label={`New ${choice.typeName} from a template`}
        data-testid="template-choice"
        className="relative w-64 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
      >
        <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          New {choice.typeName}
        </p>
        {choice.templates.map((template) => (
          <button
            key={template.id}
            type="button"
            role="menuitem"
            data-testid={`template-choice-${template.id}`}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => onPick(template.id)}
          >
            <span className="min-w-0 flex-1 truncate">{template.title}</span>
          </button>
        ))}
        <div className="my-1 h-px bg-[var(--hairline)]" />
        <button
          type="button"
          role="menuitem"
          data-testid="template-choice-blank"
          className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => onPick(null)}
        >
          Blank card
        </button>
      </div>
    </div>
  );
}
