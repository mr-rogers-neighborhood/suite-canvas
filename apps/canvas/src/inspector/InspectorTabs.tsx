import { tabKeyDown } from "../dialogs/tabKeys";
import type { InspectorTabId } from "./capabilities";

export interface InspectorTabEntry {
  id: InspectorTabId;
  label: string;
}

/**
 * The tab strip every inspector shares.
 *
 * The panels used to draw three of these — cards, containers and the link inspector —
 * with the same markup and three copies of the arrow-key rules. Which tabs exist is
 * `tabsFor`'s answer; this only draws them, so a tab that an entity cannot show is a
 * tab that was never asked for.
 */
export function InspectorTabs({
  tabs,
  active,
  ariaLabel,
  testId,
  tabTestId,
  idPrefix,
  className,
  onSelect,
}: {
  tabs: readonly InspectorTabEntry[];
  active: InspectorTabId;
  ariaLabel: string;
  testId: string;
  tabTestId: (id: InspectorTabId) => string;
  /** Stem for the `id`/`aria-controls` pair the panels point at. */
  idPrefix: string;
  className?: string;
  onSelect: (id: InspectorTabId) => void;
}) {
  const tabId = (id: InspectorTabId) => `${idPrefix}-${id}-tab`;
  const panelId = (id: InspectorTabId) => `${idPrefix}-${id}-panel`;
  const select = (index: number) => {
    const next = tabs[index];
    if (!next) return;
    onSelect(next.id);
    // Focus follows the selection, or the next arrow press would start from a
    // tab that is no longer the selected one.
    document.getElementById(tabId(next.id))?.focus();
  };
  return (
    <div className={className ?? "card-panel-tabs px-3 pb-2"} data-testid={testId}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="segmented"
        onKeyDown={(event) => {
          tabKeyDown(
            event,
            tabs.findIndex((entry) => entry.id === active),
            tabs.length,
            select,
          );
        }}
      >
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={tabId(entry.id)}
            aria-controls={panelId(entry.id)}
            aria-selected={entry.id === active}
            tabIndex={entry.id === active ? 0 : -1}
            data-testid={tabTestId(entry.id)}
            className="segmented-option"
            data-checked={entry.id === active ? "true" : undefined}
            onClick={() => onSelect(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The ids a panel needs to point its tab at. */
export function inspectorPanelIds(
  idPrefix: string,
): Record<InspectorTabId, { tab: string; panel: string }> {
  const pair = (id: InspectorTabId) => ({
    tab: `${idPrefix}-${id}-tab`,
    panel: `${idPrefix}-${id}-panel`,
  });
  return { details: pair("details"), content: pair("content"), style: pair("style") };
}
