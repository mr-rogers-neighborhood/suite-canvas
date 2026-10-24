import type { Meta, StoryObj } from "@storybook/react-vite";
import { ViewTabs } from "./ViewTabs";

const views = [
  {
    id: "v1",
    name: "Research",
    camera: { x: 0, y: 0, zoom: 1 },
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "v2",
    name: "Drafts",
    camera: { x: 120, y: 40, zoom: 0.5 },
    createdAt: 1,
    updatedAt: 1,
  },
];

const meta = {
  title: "Components/ViewTabs",
  component: ViewTabs,
  parameters: { layout: "centered" },
  args: {
    views,
    activeViewId: "v1",
    onSelect: () => {},
    onCreate: () => {},
    onRename: () => {},
    onDeleteRequest: () => {},
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ViewTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SecondViewActive: Story = { args: { activeViewId: "v2" } };

export const Empty: Story = { args: { views: [], activeViewId: null } };
