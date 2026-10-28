import { tabLabel, tabsFor } from "../inspector/capabilities";
import { InspectorTabs } from "../inspector/InspectorTabs";
import type { CardPanelTab } from "./CardPanel";

/** The card's tab strip: whichever tabs the card capability table grants it. */
export function CardPanelTabs({
  tab,
  tutorialCard,
  idPrefix,
  onSelect,
}: {
  tab: CardPanelTab;
  /** A tutorial's body is its timeline, so the tab reads "Steps". */
  tutorialCard: boolean;
  idPrefix: string;
  onSelect: (tab: CardPanelTab) => void;
}) {
  const tabs = tabsFor(["card"]).map((entry) => ({
    id: entry.id,
    label: tabLabel(entry.id, "card", { tutorial: tutorialCard }),
  }));
  return (
    <InspectorTabs
      tabs={tabs}
      active={tab}
      ariaLabel="Card sections"
      testId="card-panel-tabs"
      tabTestId={(id) => `card-panel-tab-${id}`}
      idPrefix={idPrefix}
      onSelect={onSelect}
    />
  );
}
