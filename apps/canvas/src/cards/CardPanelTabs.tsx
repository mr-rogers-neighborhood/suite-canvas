import type { KeyboardEvent } from "react";
import type { CardPanelTab } from "./CardPanel";

const TAB_ORDER: CardPanelTab[] = ["details", "content", "style"];

/** The Details / Content / Style tab strip; the drawer draws its own body. */
export function CardPanelTabs({
  tab,
  tutorialCard,
  ids,
  onSelect,
}: {
  tab: CardPanelTab;
  /** A tutorial's body is its timeline, so the tab reads "Steps". */
  tutorialCard: boolean;
  ids: {
    detailsTabId: string;
    detailsPanelId: string;
    contentTabId: string;
    contentPanelId: string;
    styleTabId: string;
    stylePanelId: string;
  };
  onSelect: (tab: CardPanelTab) => void;
}) {
  const { detailsTabId, detailsPanelId, contentTabId, contentPanelId, styleTabId, stylePanelId } =
    ids;
  const idsByTab: Record<CardPanelTab, string> = {
    details: detailsTabId,
    content: contentTabId,
    style: styleTabId,
  };
  // A tablist promises arrow-key movement and one stop in the tab order, so the
  // selected tab carries `tabIndex=0` and the arrows move the selection.
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const deltas: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    const delta = deltas[event.key];
    const at = TAB_ORDER.indexOf(tab);
    if (delta === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? TAB_ORDER[0]
        : event.key === "End"
          ? TAB_ORDER[TAB_ORDER.length - 1]
          : TAB_ORDER[(at + (delta ?? 0) + TAB_ORDER.length) % TAB_ORDER.length];
    if (!next) return;
    onSelect(next);
    // Focus follows the selection, or the next arrow press would start from a
    // tab that is no longer the selected one.
    document.getElementById(idsByTab[next])?.focus();
  };
  return (
    <div className="card-panel-tabs px-3 pb-2" data-testid="card-panel-tabs">
      <div role="tablist" aria-label="Card sections" className="segmented" onKeyDown={move}>
        <button
          type="button"
          role="tab"
          id={detailsTabId}
          aria-controls={detailsPanelId}
          aria-selected={tab === "details"}
          tabIndex={tab === "details" ? 0 : -1}
          data-testid="card-panel-tab-details"
          className="segmented-option"
          data-checked={tab === "details" ? "true" : undefined}
          onClick={() => onSelect("details")}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          id={contentTabId}
          aria-controls={contentPanelId}
          aria-selected={tab === "content"}
          tabIndex={tab === "content" ? 0 : -1}
          data-testid="card-panel-tab-content"
          className="segmented-option"
          data-checked={tab === "content" ? "true" : undefined}
          onClick={() => onSelect("content")}
        >
          {tutorialCard ? "Steps" : "Content"}
        </button>
        <button
          type="button"
          role="tab"
          id={styleTabId}
          aria-controls={stylePanelId}
          aria-selected={tab === "style"}
          tabIndex={tab === "style" ? 0 : -1}
          data-testid="card-panel-tab-style"
          className="segmented-option"
          data-checked={tab === "style" ? "true" : undefined}
          onClick={() => onSelect("style")}
        >
          Style
        </button>
      </div>
    </div>
  );
}
