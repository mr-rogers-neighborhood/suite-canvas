import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConflictDialog } from "./SharePublishButton";

/**
 * The publish conflict dialog takes plain data, so it mounts without a share
 * session or a relay: the field rows and their checkboxes are the whole surface.
 */
const conflict = {
  conflicts: [
    {
      key: "card:c1:body",
      kind: "body" as const,
      label: "Alpha \u00b7 paragraph",
      message: "Body changed.",
    },
    {
      key: "card:c1:title",
      kind: "title" as const,
      label: "Alpha \u00b7 title",
      message: "Title changed.",
    },
  ],
  unsupported: [],
  reason: null,
  code: null,
};

const meta = {
  title: "Components/ConflictDialog",
  component: ConflictDialog,
  parameters: { layout: "fullscreen" },
  args: {
    conflict,
    publishing: false,
    reloading: false,
    onPublishSelected: () => {},
    onReload: () => {},
    onClose: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ConflictDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
