import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DrawingElement } from "@suite/graph";
import { SketchPanel } from "./SketchPanel";

const strokes = [
  {
    id: "rect-1",
    type: "rectangle",
    x: 40,
    y: 40,
    width: 160,
    height: 90,
    strokeColor: "#3b82f6",
    backgroundColor: "#dbeafe",
    strokeWidth: 2,
  },
  {
    id: "arrow-1",
    type: "arrow",
    x: 210,
    y: 85,
    width: 120,
    height: 0,
    strokeColor: "#1e1e1e",
    strokeWidth: 2,
    points: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
    ],
  },
  {
    id: "ellipse-1",
    type: "ellipse",
    x: 340,
    y: 40,
    width: 90,
    height: 90,
    strokeColor: "#f97316",
    backgroundColor: "#ffedd5",
    strokeWidth: 2,
  },
] as unknown as DrawingElement[];

const meta = {
  title: "Cards/SketchPanel",
  component: SketchPanel,
  args: { elements: strokes, label: "Sketch" },
} satisfies Meta<typeof SketchPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What a sketch's Content tab shows: the drawing, one click from the surface. */
export const Openable: Story = { args: { onOpen: () => {} } };

/** A read-only session reads the same drawing with no door into it. */
export const ReadOnly: Story = {};

/** A sketch nobody has drawn in yet. */
export const Empty: Story = { args: { elements: [], onOpen: () => {} } };
