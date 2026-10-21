import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dock } from "./Dock";

const meta = {
  title: "Components/Dock",
  component: Dock,
  parameters: { layout: "fullscreen" },
  args: {
    inboxCount: 0,
    libraryOpen: false,
    onToggleLibrary: () => {},
    onCreateCard: () => {},
  },
  decorators: [
    (Story) => (
      <div className="relative h-64 w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof Dock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithInbox: Story = { args: { inboxCount: 4 } };

export const LibraryOpen: Story = { args: { libraryOpen: true, inboxCount: 2 } };
