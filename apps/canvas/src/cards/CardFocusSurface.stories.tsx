import type { Meta, StoryObj } from "@storybook/react-vite";
import { CardFocusSurface } from "./CardFocusSurface";

const meta = {
  title: "Components/CardFocusSurface",
  component: CardFocusSurface,
  parameters: { layout: "fullscreen" },
  args: {
    title: "Onboarding friction",
    onClose: () => {},
    // The render below supplies the card; the story args still have to satisfy
    // the shell's prop type.
    children: null,
  },
  render: (args) => (
    <div style={{ position: "relative", height: "100vh", background: "var(--canvas-bg)" }}>
      <CardFocusSurface {...args}>
        <article style={{ padding: 16, fontSize: 13, lineHeight: 1.6 }}>
          <p>
            The first-run tour asks for a workspace name before it shows what a workspace is. Two
            people in the pilot dropped out at that step.
          </p>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginTop: 16 }}>What we heard</h2>
          <p>&ldquo;I did not know whether I was naming the team or the document.&rdquo;</p>
        </article>
      </CardFocusSurface>
    </div>
  ),
  tags: ["autodocs"],
} satisfies Meta<typeof CardFocusSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** With the inspector open the sheet keeps clear of the drawer. */
export const InspectorOpen: Story = {
  args: { insetRight: 344, children: null },
};
