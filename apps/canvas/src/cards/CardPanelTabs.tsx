import type { CardPanelTab } from "./CardPanel";

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
  return (
    <div className="card-panel-tabs px-3 pb-2" data-testid="card-panel-tabs">
      <div role="tablist" aria-label="Card sections" className="segmented">
        <button
          type="button"
          role="tab"
          id={detailsTabId}
          aria-controls={detailsPanelId}
          aria-selected={tab === "details"}
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
