import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommandPalette } from "./CommandPalette";
import type { PaletteItem } from "./paletteRank";

/**
 * The palette takes plain rows, so it mounts with no document at all: the
 * shortcut column and the empty state are the two things a snapshot can catch.
 */
const rows: PaletteItem[] = [
  {
    id: "palette.open",
    title: "Open the command palette",
    group: "Navigation",
    weight: 1,
    shortcut: "\u2318K",
    run: () => {},
  },
  {
    id: "library.search",
    title: "Search every card",
    subtitle: "Library search",
    group: "Navigation",
    weight: 5,
    shortcut: "\u2318\u21e7K",
    run: () => {},
  },
  {
    id: "card.create:note",
    title: "New note",
    subtitle: "Card on this board",
    group: "Create",
    weight: 50,
    shortcut: "\u2318Enter",
    run: () => {},
  },
  {
    id: "board.open:b2",
    title: "Research",
    subtitle: "Board",
    group: "Boards",
    weight: 10,
    run: () => {},
  },
];

const meta = {
  title: "Components/CommandPalette",
  component: CommandPalette,
  parameters: { layout: "fullscreen" },
  args: { items: rows, onClose: () => {} },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { items: [] } };
