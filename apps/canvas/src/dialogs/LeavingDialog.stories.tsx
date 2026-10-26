import type { Meta, StoryObj } from "@storybook/react-vite";
import { LeavingDialog } from "./LeavingDialog";

const meta = {
  title: "Components/LeavingDialog",
  component: LeavingDialog,
  parameters: { layout: "fullscreen" },
  args: {
    workspaceId: "ws-demo",
    title: "Product notes",
    onLeave: () => {},
    onDismiss: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LeavingDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The anonymous, no-promise case: the two existing ways out, and one honest way through. */
export const AtRisk: Story = {
  args: { onSignIn: () => {} },
};

/** A build with no accounts offers the export and the way out, and nothing it cannot do. */
export const WithoutAccounts: Story = {};
