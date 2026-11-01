import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Annotation, AnnotationStyle } from "@suite/graph";
import { WorkspaceDocument } from "@suite/graph";
import type { ReactElement } from "react";
import { usePlaceStackStore } from "../canvas/placeStack";
import { useCanvasStore } from "../store/useCanvasStore";
import { BookHighlights } from "./BookHighlights";

/**
 * A book's list of marks, including the two states that are layout questions rather than behaviour ones: a row expanded
 * to its whole passage, and a selection being built for a batch place.
 *
 * The expanded block is `flex: 1 0 100%`, which only takes a line of its own because the row wraps. That is not something
 * a unit test can see, so it is something a story has to show.
 */
const styles: AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
  { id: "style-blue", name: "Question", color: "#4c8dff", order: 1 },
];

const LONG =
  "A sentence that runs on far past the point where one line can hold it, which is exactly the case the expander exists " +
  "for: the row shows a first sight of the words and the disclosure shows all of them.";

function annotations(): Annotation[] {
  return [1, 2, 3].map((n) => ({
    id: `a${String(n)}`,
    sourceCardId: "book-1",
    styleId: n === 2 ? "style-blue" : "style-yellow",
    anchor: {
      kind: "quote",
      locator: "OEBPS/text/chapter1.xhtml",
      quote: `${LONG} (${String(n)})`,
      prefix: "",
      suffix: "",
    },
    excerpt: `${LONG} (${String(n)})`,
    createdAt: n,
    ...(n === 1
      ? {
          parts: [
            { id: "p1", start: 2, end: 10, target: { kind: "field" as const, name: "Question" } },
            { id: "p2", start: 11, end: 24, target: { kind: "title" as const } },
          ],
        }
      : {}),
  }));
}

function seed(): WorkspaceDocument {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const book = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText(book.id, "A Small Book");
  useCanvasStore.setState({ workspace });
  usePlaceStackStore.getState().stop();
  return workspace;
}

const meta = {
  title: "Reader/BookHighlights",
  decorators: [
    (Story: () => ReactElement) => {
      seed();
      return (
        <div style={{ width: 320, padding: 10, background: "var(--surface)" }}>
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Nothing picked: a row is a press away from being raised. */
export const Default: Story = {
  render: () => (
    <BookHighlights
      annotations={annotations()}
      styles={styles}
      onOpen={() => {}}
      onPlace={() => {}}
      onPlaceMany={() => {}}
    />
  ),
};

/**
 * Both new layout states: a row expanded to its whole passage with its parts, and a selection being built.
 *
 * Driven by a `play` script rather than by props: the states are the component's own, and it should not grow props only
 * a story needs.
 */
export const ExpandedAndPicked: Story = {
  render: () => (
    <BookHighlights
      annotations={annotations()}
      styles={styles}
      onOpen={() => {}}
      onPlace={() => {}}
      onPlaceMany={() => {}}
    />
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    canvasElement.querySelector<HTMLElement>('[data-testid="book-highlight-expand-a1"]')?.click();
    canvasElement.querySelector<HTMLElement>('[data-testid="book-highlight-pick-a2"]')?.click();
  },
};
