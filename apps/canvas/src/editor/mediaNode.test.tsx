import { render, waitFor } from "@testing-library/react";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Attachment } from "./attachmentNode";
import { ImageLink } from "./imageLinkNode";
import { MEDIA_NODE_NAME, Media } from "./mediaNode";
import { Video } from "./videoNode";
import { YouTube } from "./youtubeNode";

const ID = "0123456789abcdef0123456789abcdef";

function extensions() {
  return [StarterKit.configure({ undoRedo: false }), Attachment, ImageLink, Video, YouTube, Media];
}

function body(attrs: Record<string, unknown>): JSONContent {
  return { type: "doc", content: [{ type: MEDIA_NODE_NAME, attrs }] };
}

function Harness({ content }: { content: JSONContent }) {
  const editor = useEditor({ extensions: extensions(), content });
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

describe("the media node", () => {
  it("should draw an image that names stored bytes through the attachment view", async () => {
    const { container } = render(
      <Harness content={body({ kind: "image", id: ID, mime: "image/png", name: "shot.png" })} />,
    );

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")?.getAttribute("src")).toContain(`/api/attachments/${ID}`);
  });

  it("should draw an image that names an address through the link view", async () => {
    const { container } = render(
      <Harness
        content={body({
          kind: "image",
          src: "https://cdn.example.com/a.png",
          alt: "a.png",
        })}
      />,
    );

    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it("should draw a video with its controls", async () => {
    const { container } = render(
      <Harness content={body({ kind: "video", id: ID, mime: "video/mp4", name: "clip.mp4" })} />,
    );

    await waitFor(() => expect(container.querySelector("video")).not.toBeNull());
    expect(container.querySelector("video")).toHaveAttribute("controls");
  });

  it("should draw an embed as an iframe", async () => {
    const { container } = render(
      <Harness content={body({ kind: "youtube", videoId: "dQw4w9WgXcQ" })} />,
    );

    await waitFor(() => expect(container.querySelector("iframe")).not.toBeNull());
    expect(container.querySelector("iframe")?.getAttribute("src")).toContain(
      "youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });
});
