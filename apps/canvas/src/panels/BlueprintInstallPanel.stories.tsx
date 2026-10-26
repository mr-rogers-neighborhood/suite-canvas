import type { Meta, StoryObj } from "@storybook/react-vite";
import { BlueprintInstallPanel } from "./BlueprintInstallPanel";

const spec = {
  name: "Claim",
  version: 3,
  fields: [
    { name: "Confidence", kind: "select" as const, required: false },
    { name: "Source", kind: "card" as const, required: false },
    { name: "Reviewed", kind: "date" as const, required: true },
  ],
  starterContent: "Say what the source claims, then what it will not support.",
};

const meta = {
  title: "Panels/BlueprintInstallPanel",
  component: BlueprintInstallPanel,
  parameters: { layout: "fullscreen" },
  args: { spec, existingType: null, onInstall: () => {} },
  decorators: [
    (Story) => (
      <div className="h-80 w-full p-6">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof BlueprintInstallPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A first install: three new fields, and the content a new card starts with. */
export const Fresh: Story = {};

/** The same blueprint after a version bump: one new field, the rest kept as they are. */
export const VersionBump: Story = {
  args: {
    existingType: {
      id: "claim",
      name: "Claim",
      fields: [{ name: "Confidence" }, { name: "Source" }],
    } as never,
  },
};
