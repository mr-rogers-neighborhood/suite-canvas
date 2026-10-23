import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent } from "storybook/test";
import { RecoveryKeyDialog } from "./RecoveryKeyDialog";

/**
 * The creation prompt is the one place a new workspace asks for a passphrase.
 * Its two states are the honest offer and the refusal of a weak phrase.
 */
const meta = {
  title: "Components/RecoveryKeyDialog",
  component: RecoveryKeyDialog,
  parameters: { layout: "fullscreen" },
  args: {
    mode: "creation-prompt",
    workspaceId: "ws-demo",
    ownerKey: "generated-owner-key",
    title: "Untitled workspace",
    onClose: () => {},
    onSkip: () => {},
    onSetPassphrase: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof RecoveryKeyDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CreationChoice: Story = {
  play: async () => {
    // One decision, and the copy says what each answer survives.
    await expect(screen.getByTestId("recovery-creation-copy")).toHaveTextContent(
      "A passphrase survives a lost device and opens this workspace on any device with the URL",
    );
    await expect(screen.getByTestId("recovery-creation-set")).toBeEnabled();
    await expect(screen.getByTestId("recovery-creation-skip")).toBeEnabled();
  },
};

export const CreationWeakPassphrase: Story = {
  play: async () => {
    await userEvent.type(screen.getByTestId("recovery-passphrase-input"), "cat dog");
    // The button stays usable and names the rule instead of only disabling.
    await expect(screen.getByTestId("recovery-passphrase-problem")).toHaveTextContent(
      "at least 4 words and 16 characters",
    );
    await userEvent.click(screen.getByTestId("recovery-creation-set"));
    await expect(screen.getByTestId("recovery-error")).toHaveTextContent(
      "at least 4 words and 16 characters",
    );
    await expect(screen.getByTestId("recovery-creation-set")).toBeEnabled();
  },
};
