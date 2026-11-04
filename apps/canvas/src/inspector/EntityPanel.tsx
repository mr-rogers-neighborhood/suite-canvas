import type { ReactNode } from "react";
import type { InspectorTabId } from "./capabilities";
import { type InspectorTabEntry, InspectorTabs } from "./InspectorTabs";

/**
 * The drawer's shell: one header, one body slot, one close.
 *
 * The card, container and link panels each grew their own version of this — the same `<aside>`, the
 * same two-line header, three copies of the close button — and drifted: one had a peer tag slot, one
 * had an inline rename, one had neither. What differs between them is *what kind of thing* they
 * describe and what a reader can do to it from the header, so those are props and the rest is one
 * piece of markup.
 *
 * The body owns its tab strip (`InspectorTabs`) because a tab strip needs the panel's state, and a
 * shell that held it would have to hold the state too.
 */
export interface EntityPanelProps {
  /** The kind, for the attribute a surface or a test may read. */
  kind: string;
  /** The one line that names the thing: a title, a file name, a pair of ends. */
  title: ReactNode;
  /** The second line: what it is, and how much of it the selection holds. */
  subtitle?: ReactNode;
  /** Header buttons besides the close: locate, edit, open the board. */
  actions?: ReactNode;
  /**
   * The tab strip, when the panel has one.
   *
   * The shell draws it because the strip is chrome, not content: the panel says which tabs its subject
   * is entitled to (`tabsFor`) and which is active, and the same markup serves every kind. The card
   * panel keeps its own strip, because its tab set depends on the card's model (a tutorial reads
   * "Steps") and its active tab follows the card's editing state, which the shell cannot know.
   */
  tabs?: readonly InspectorTabEntry[] | undefined;
  activeTab?: InspectorTabId | undefined;
  onTab?: ((tab: InspectorTabId) => void) | undefined;
  /** Stem for the `id`/`aria-controls` pair the strip points at. */
  tabIdPrefix?: string | undefined;
  tabsTestId?: string | undefined;
  tabTestId?: ((id: InspectorTabId) => string) | undefined;
  onClose: () => void;
  closeLabel?: string;
  closeTestId?: string;
  testId: string;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}

export function EntityPanel({
  kind,
  title,
  subtitle,
  actions,
  tabs,
  activeTab,
  onTab,
  tabIdPrefix,
  tabsTestId,
  tabTestId,
  onClose,
  closeLabel = "Close",
  closeTestId,
  testId,
  ariaLabel,
  className = "",
  children,
}: EntityPanelProps) {
  return (
    <aside
      className={`card-inspector ${className}`.trim()}
      data-testid={testId}
      data-handbook-region="card-inspector"
      data-kind={kind}
      aria-label={ariaLabel}
    >
      <header className="flex items-start gap-2 border-b border-[var(--hairline)] px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[13px] font-semibold text-[var(--ink)]"
            data-testid={`${testId}-title`}
          >
            {title}
          </p>
          {subtitle === undefined ? null : (
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
              {subtitle}
            </p>
          )}
        </div>
        {actions}
        <button
          type="button"
          aria-label={closeLabel}
          {...(closeTestId === undefined ? {} : { "data-testid": closeTestId })}
          className="rounded px-1.5 text-[13px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          {"\u00d7"}
        </button>
      </header>
      {tabs !== undefined && activeTab !== undefined && onTab !== undefined ? (
        <InspectorTabs
          tabs={tabs}
          active={activeTab}
          ariaLabel={`${ariaLabel}: sections`}
          testId={tabsTestId ?? `${testId}-tabs`}
          tabTestId={tabTestId ?? ((id) => `${testId}-tab-${id}`)}
          idPrefix={tabIdPrefix ?? testId}
          className="card-panel-tabs px-3 pb-1"
          onSelect={onTab}
        />
      ) : null}
      {children}
    </aside>
  );
}
