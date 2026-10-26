import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ShareUnavailable } from "./ShareUnavailable";

/**
 * What a reader meets when a published page is gone. The component is a whole
 * page, so each story is a viewport rather than a control state.
 */
const meta = {
  title: "Sharing/ShareUnavailable",
  component: ShareUnavailable,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ShareUnavailable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A revoked card link, named by the slug in the reader address. */
export const Revoked: Story = {
  args: { page: "research-roadmap", message: "Share not found." },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading")).toHaveTextContent("This page was unpublished.");
    await expect(canvas.getByText(/revoked the link to research-roadmap/u)).toBeInTheDocument();
  },
};

/** The same page when the address carries no slug to name it by. */
export const Unnamed: Story = {
  args: { page: null },
};
