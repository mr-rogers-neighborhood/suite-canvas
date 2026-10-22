import type { Meta, StoryObj } from "@storybook/react-vite";
import type { FieldDefinition } from "@suite/graph";
import { PropertyBlockChip } from "./PropertyBlockChip";

const text = (overrides: Partial<FieldDefinition> = {}): FieldDefinition => ({
  id: "owner",
  name: "Owner",
  kind: "text",
  required: false,
  order: 0,
  options: [],
  ...overrides,
});

const meta = {
  title: "Components/PropertyBlockChip",
  component: PropertyBlockChip,
  args: {
    field: text(),
    value: "Ada Lovelace",
    onCommit: () => {},
    onOpenPanel: () => {},
  },
  decorators: [
    (Story) => (
      <p className="max-w-md p-4 text-sm text-[var(--ink)]">
        Kickoff notes <Story /> for the rewrite.
      </p>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof PropertyBlockChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { value: undefined },
};

export const NumberValue: Story = {
  args: { field: text({ id: "estimate", name: "Estimate", kind: "number" }), value: 3 },
};

export const Select: Story = {
  args: {
    field: text({
      id: "status",
      name: "Status",
      kind: "select",
      options: [
        { id: "todo", label: "To do", order: 0 },
        { id: "done", label: "Done", order: 1 },
      ],
    }),
    value: "done",
  },
};

export const LinkedCard: Story = {
  args: {
    field: text({ id: "related", name: "Related", kind: "card" }),
    value: "card-2",
    cardLabel: "Onboarding friction",
  },
};

export const MissingField: Story = {
  args: { field: undefined },
};
