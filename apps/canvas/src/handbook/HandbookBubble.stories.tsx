import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { useHandbookStore } from "../store/handbookStore";
import { useUiStore } from "../store/useUiStore";
import { HandbookBubble } from "./HandbookBubble";

/**
 * The handbook is a shell float, so the stories draw the corner of a shell: fake regions
 * standing in for the title bar and the inspector (those are what the count is computed from),
 * and the bubble beside them.
 *
 * Its state lives in a store rather than in props, so the wrapper sets the store a story needs
 * before the bubble renders.
 */
interface HandbookStoryProps {
  open: boolean;
  articleId?: string | null;
  pane?: "handbook" | "feedback";
}

function HandbookStory({ open, articleId = null, pane = "handbook" }: HandbookStoryProps) {
  useEffect(() => {
    useUiStore.setState({ activeBoardId: "story-board", purpose: "explore", selectedNodeIds: [] });
    useHandbookStore.setState({
      open,
      articleId,
      lastArticleId: articleId,
      pane,
      scope: [],
      picking: false,
      collapsed: { x: 420, y: 240, width: 196, height: 36 },
      expanded: { x: 300, y: 40, width: 360, height: 460 },
    });
  }, [open, articleId, pane]);

  return (
    <>
      <div data-handbook-region="title-bar" />
      <div data-handbook-region="card-inspector" />
      <HandbookBubble />
    </>
  );
}

const meta = {
  title: "Shell/HandbookBubble",
  component: HandbookStory,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "560px",
          background: "var(--surface)",
        }}
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HandbookStory>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Collapsed: a pill, the count, and the last article it was reading. */
export const Collapsed: Story = { args: { open: false } };

/** Open: the articles that match this screen, most specific first. */
export const Open: Story = { args: { open: true } };

/** One article, as a reader sees it, with the target it can point at. */
export const Article: Story = { args: { open: true, articleId: "chrome/title-bar" } };

/** The same corner is where feedback is filed, naming the article it is about. */
export const Feedback: Story = {
  args: { open: true, articleId: "chrome/title-bar", pane: "feedback" },
};
