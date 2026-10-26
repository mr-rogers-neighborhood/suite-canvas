import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { useUiStore } from "../store/useUiStore";
import { ExplainPanel } from "./ExplainPanel";

/** The panel is hidden unless the canvas is in its purpose, so the stories set it. */
function InExplain() {
  useEffect(() => {
    useUiStore.setState({ purpose: "explain" });
    return () => useUiStore.setState({ purpose: "explore" });
  }, []);
  return null;
}

const meta = {
  title: "Canvas/ExplainPanel",
  component: ExplainPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ position: "relative", width: "100%", height: "420px" }}>
        <InExplain />
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ExplainPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Nothing selected: the panel is the instruction rather than an empty box. */
export const Empty: Story = {
  args: { context: { entities: [], links: [], partial: false } },
};

/** The shape explain exists for: a few things, their kinds, and the links between. */
export const Gathered: Story = {
  args: {
    context: {
      entities: [
        {
          id: "a",
          title: "Retrieval beats re-reading",
          kind: "claim",
          fields: [
            { label: "Confidence", value: "high" },
            { label: "Source", value: "Roediger & Karpicke, 2006" },
          ],
        },
        {
          id: "b",
          title: "Spaced repetition",
          kind: "concept",
          fields: [{ label: "Horizon", value: "weeks" }],
        },
        { id: "c", title: "Study plan", kind: "note", fields: [] },
      ],
      links: [
        { id: "e1", from: "Retrieval beats re-reading", to: "Spaced repetition", kind: "supports" },
        { id: "e2", from: "Spaced repetition", to: "Study plan", kind: "depends on" },
      ],
      partial: false,
    },
  },
};

/** A board or a peer's deleted card in the selection: said out loud, not hidden. */
export const PartlyUnexplainable: Story = {
  args: {
    context: {
      entities: [{ id: "a", title: "Retrieval beats re-reading", kind: "claim", fields: [] }],
      links: [],
      partial: true,
    },
  },
};
