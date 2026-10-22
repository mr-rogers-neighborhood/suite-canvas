import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PropertyValue } from "@suite/graph";
import { useState } from "react";
import { PropertyField } from "./PropertyField";

const textField = {
  id: "text",
  name: "Owner",
  kind: "text" as const,
  required: false,
  order: 0,
  options: [],
};

const fields = [
  textField,
  {
    id: "number",
    name: "Estimate",
    kind: "number" as const,
    required: false,
    order: 1,
    options: [],
  },
  { id: "date", name: "Due", kind: "date" as const, required: false, order: 2, options: [] },
  {
    id: "select",
    name: "Stage",
    kind: "select" as const,
    required: false,
    order: 3,
    options: [
      { id: "a", label: "Backlog", order: 0 },
      { id: "b", label: "Doing", order: 1 },
    ],
  },
  {
    id: "multi",
    name: "Labels",
    kind: "multiSelect" as const,
    required: false,
    order: 4,
    options: [
      { id: "a", label: "Research", order: 0 },
      { id: "b", label: "Design", order: 1 },
    ],
  },
  { id: "done", name: "Done", kind: "checkbox" as const, required: false, order: 5, options: [] },
  {
    id: "card",
    name: "Contradicts",
    kind: "card" as const,
    required: false,
    order: 6,
    options: [],
  },
];

const initial: Record<string, PropertyValue> = {
  text: "Ada Lovelace",
  number: 3,
  date: "2026-10-22",
  select: "b",
  multi: ["a", "b"],
  done: true,
  card: "c2",
};

function Gallery() {
  const [values, setValues] = useState(initial);
  return (
    <div className="w-[340px] space-y-3 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4">
      {fields.map((field) => (
        <div key={field.id} className="space-y-1">
          <p className="text-[11px] font-medium text-[var(--ink-muted)]">
            {field.name}
            {field.required ? " *" : ""}
          </p>
          <PropertyField
            field={field}
            value={values[field.id]}
            onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
            onClear={() =>
              setValues((current) => {
                const next = { ...current };
                delete next[field.id];
                return next;
              })
            }
            cards={[
              { id: "c1", title: "Onboarding friction" },
              { id: "c2", title: "Pricing page rewrite" },
            ]}
            excludeCardId="c1"
          />
        </div>
      ))}
    </div>
  );
}

const meta = {
  title: "Components/PropertyField",
  component: PropertyField,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof PropertyField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryKind: Story = {
  render: () => <Gallery />,
  args: {
    field: textField,
    value: "Ada Lovelace",
    onChange: () => {},
    onClear: () => {},
  },
};
