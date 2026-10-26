import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsDialog } from "./SettingsDialog";

/**
 * Settings is the modal the theme menu and the palette both open. The appearance
 * controls write to `useAppearanceStore`, which paints `<html>`, so the canvas
 * behind the dialog is the preview in the app and the panel alone here.
 */
const meta = {
  title: "Components/SettingsDialog",
  component: SettingsDialog,
  parameters: { layout: "fullscreen" },
  args: { onClose: () => {} },
  tags: ["autodocs"],
} satisfies Meta<typeof SettingsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
