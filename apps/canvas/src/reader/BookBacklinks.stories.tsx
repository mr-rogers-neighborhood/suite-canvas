import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { BookBacklinksView } from "./BookBacklinks";

/**
 * What a book is connected to.
 *
 * Two lists with different jobs, and the difference has to be visible at a glance: a card made from this book is the one
 * a reader is looking for again, and the reason on the right says why each of the others is here.
 */
const meta = {
  title: "Reader/BookBacklinks",
  decorators: [
    (Story: () => ReactElement) => (
      <div style={{ width: 320, padding: 10, background: "var(--surface)" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj;

const titleOf = (cardId: string): string =>
  ({
    "card-a": "Retrieval is the effort of recall",
    "card-b": "How spacing and retrieval interact",
    "card-c": "A claim about re-reading, and why it fails",
  })[cardId] ?? "Untitled";

/** Both lists: two cards out of the book, and one that points at it. */
export const Linked: Story = {
  render: () => (
    <BookBacklinksView
      produced={["card-a", "card-b"]}
      referencing={[{ cardId: "card-c", reason: { kind: "mentions" } }]}
      titleOf={titleOf}
      onOpen={() => {}}
    />
  ),
};

/** A book nobody has marked anything out of yet, which has to say so rather than show an empty panel. */
export const NothingYet: Story = {
  render: () => (
    <BookBacklinksView produced={[]} referencing={[]} titleOf={titleOf} onOpen={() => {}} />
  ),
};
