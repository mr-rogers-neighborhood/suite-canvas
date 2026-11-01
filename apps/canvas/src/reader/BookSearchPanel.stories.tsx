import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactElement } from "react";
import { BookSearchPanel } from "./BookSearchPanel";
import type { ChapterHits } from "./bookSearch";

/**
 * Finding a place by its words.
 *
 * Two things here are layout questions a unit test cannot see: the hit has to be lit *inside* its own words so a row
 * reads as a sentence rather than a list of matches, and a long chapter's results have to scroll inside the panel
 * instead of pushing the chapter off the page.
 */
const chapters: ChapterHits[] = [
  {
    path: "OEBPS/text/one.xhtml",
    title: "One — What Retrieval Is",
    hits: [
      {
        before: "Testing yourself beats re-reading, and ",
        match: "retrieval",
        after: " practice is the reason.",
      },
      {
        before: "The effort of pulling something back is what makes ",
        match: "retrieval",
        after: " work.",
      },
    ],
  },
  {
    path: "OEBPS/text/two.xhtml",
    title: "Two — Spacing",
    hits: [
      { before: "Spacing and ", match: "retrieval", after: " are the same lever pulled twice." },
    ],
  },
];

const meta = {
  title: "Reader/BookSearchPanel",
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

/** A query with hits in two chapters: the count answers "did it work" before anything is pressed. */
export const Results: Story = {
  render: () => (
    <BookSearchPanel
      indexing={false}
      query="retrieval"
      onQuery={() => {}}
      chapters={chapters}
      total={3}
      onGo={() => {}}
    />
  ),
};

/** A query with nothing behind it, which has to say so rather than show an empty panel. */
export const NoMatches: Story = {
  render: () => (
    <BookSearchPanel
      indexing={false}
      query="zzz"
      onQuery={() => {}}
      chapters={[]}
      total={0}
      onGo={() => {}}
    />
  ),
};

/** A large book still being read: the placeholder is the only thing telling the reader why nothing is happening. */
export const Indexing: Story = {
  render: () => (
    <BookSearchPanel
      indexing
      query="retrieval"
      onQuery={() => {}}
      chapters={[]}
      total={0}
      onGo={() => {}}
    />
  ),
};
