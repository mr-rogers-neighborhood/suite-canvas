import type { Meta, StoryObj } from "@storybook/react-vite";
import { AnnotationReader } from "./AnnotationReader";

const text = "A study of retrieval practice shows that testing beats rereading.";

const read = {
  ok: true as const,
  record: {
    cardId: "note-1",
    sourceCardId: "paper-1",
    quote: "retrieval practice",
    start: 11,
    end: 29,
  },
};

const source = { title: "Roediger & Karpicke", text };

const meta = {
  title: "Panels/AnnotationReader",
  component: AnnotationReader,
  parameters: { layout: "fullscreen" },
  args: { read, source, onOpenSource: () => {} },
  decorators: [
    (Story) => (
      <div className="h-64 w-full p-6">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof AnnotationReader>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The passage is where the card says: nothing to explain. */
export const Anchored: Story = {};

/** An edit moved the passage. The range followed it, so the reader stays silent. */
export const FollowsTheSource: Story = {
  args: { source: { ...source, text: `Preface. ${text}` } },
};

/** The passage appears twice and neither copy is the recorded one. */
export const TwoMatches: Story = {
  args: { source: { ...source, text: `Intro. ${text} Again: retrieval practice.` } },
};

/** The source no longer contains the passage. This is the one state that asks for action. */
export const Stale: Story = {
  args: { source: { ...source, text: "The source was rewritten." } },
};

/** A card whose type never declared the fields: a plain card, said plainly. */
export const Incomplete: Story = {
  args: {
    read: { ok: false, code: "annotation.record.incomplete", fields: ["source", "quote"] },
    source: null,
  },
};
