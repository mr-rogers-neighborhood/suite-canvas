import type { Meta, StoryObj } from "@storybook/react-vite";
import type { TypeTableRow } from "../ice/useTypeTable";
import { TypeTable } from "./TypeTable";

const rows: TypeTableRow[] = [
  { typeId: "note", name: "Note", glyph: "\u25a1", count: 12, share: 0.52 },
  {
    typeId: "concept",
    name: "Concept",
    glyph: "\u25c6",
    color: "#8b5cf6",
    count: 7,
    share: 0.3,
  },
  { typeId: "source", name: "Source", glyph: "\u25a7", count: 3, share: 0.13 },
  { typeId: "project", name: "Project", glyph: "P", color: "#10b981", count: 1, share: 0.04 },
];

const meta = {
  title: "Components/TypeTable",
  component: TypeTable,
  parameters: { layout: "centered" },
  args: {
    rows,
    boardId: "board-research",
    onFrameType: () => {},
    onSelectAll: () => {},
    onPlaceOnView: () => {},
    onDuplicate: () => {},
    canEditContent: true,
    canEditLayout: true,
  },
  decorators: [
    (Story) => (
      <div className="w-80 rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)]">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof TypeTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The populated ceiling: every type on the board, with count and share. */
export const Populated: Story = {};

/** An empty board still shows the section, with its empty line. */
export const Empty: Story = { args: { rows: [] } };
