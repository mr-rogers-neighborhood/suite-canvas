import { render, screen, waitFor } from "@testing-library/react";
import { LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { BODY_PLACEHOLDER } from "./CardBodyEditor";
import { StaticCardBody, StaticCardFace, StaticCardTitle } from "./StaticCardFace";

describe("StaticCardTitle", () => {
  it("renders 'Untitled' when titleId is not provided", () => {
    const doc = new LoroDoc();
    render(<StaticCardTitle cardDoc={doc} />);
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("renders 'Untitled' when title container is empty", () => {
    const doc = new LoroDoc();
    const titleMap = doc.getMap("titles").ensureMergeableMap("c1");
    render(<StaticCardTitle cardDoc={doc} titleId={titleMap.id} />);
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("renders plain title text", () => {
    const doc = new LoroDoc();
    const titleMap = doc.getMap("titles").ensureMergeableMap("c1");
    titleMap.set("nodeName", "doc");
    const children = titleMap.getOrCreateContainer("children", new LoroList());
    const p = children.insertContainer(0, new LoroMap());
    p.set("nodeName", "paragraph");
    const pChildren = p.getOrCreateContainer("children", new LoroList());
    const text = pChildren.insertContainer(0, new LoroText());
    text.insert(0, "My Awesome Project");
    doc.commit();

    render(<StaticCardTitle cardDoc={doc} titleId={titleMap.id} />);
    expect(screen.getByText("My Awesome Project")).toBeInTheDocument();
  });

  it("renders formatted title with bold, italic, code, and link", () => {
    const doc = new LoroDoc();
    doc.configTextStyle({
      bold: { expand: "none" },
      italic: { expand: "none" },
      code: { expand: "none" },
      link: { expand: "none" },
    });
    const titleMap = doc.getMap("titles").ensureMergeableMap("c1");
    titleMap.set("nodeName", "doc");
    const children = titleMap.getOrCreateContainer("children", new LoroList());
    const p = children.insertContainer(0, new LoroMap());
    p.set("nodeName", "paragraph");
    const pChildren = p.getOrCreateContainer("children", new LoroList());
    const text = pChildren.insertContainer(0, new LoroText());

    text.applyDelta([
      { insert: "Normal " },
      { insert: "Bold", attributes: { bold: {} } },
      { insert: " Italic", attributes: { italic: {} } },
      { insert: " Code", attributes: { code: {} } },
      { insert: " Link", attributes: { link: { href: "https://example.com" } } },
    ]);
    doc.commit();

    const { container } = render(<StaticCardTitle cardDoc={doc} titleId={titleMap.id} />);
    expect(container.querySelector("strong")).toHaveTextContent("Bold");
    expect(container.querySelector("em")).toHaveTextContent("Italic");
    expect(container.querySelector("code")).toHaveTextContent("Code");
    const a = container.querySelector("a");
    expect(a).toHaveTextContent("Link");
    expect(a).toHaveAttribute("href", "https://example.com");
  });

  it("renders title containing only a mention without falling back to 'Untitled'", () => {
    const doc = new LoroDoc();
    const titleMap = doc.getMap("titles").ensureMergeableMap("c1");
    titleMap.set("nodeName", "doc");
    const children = titleMap.getOrCreateContainer("children", new LoroList());
    const p = children.insertContainer(0, new LoroMap());
    p.set("nodeName", "paragraph");
    const pChildren = p.getOrCreateContainer("children", new LoroList());
    const mention = pChildren.insertContainer(0, new LoroMap());
    mention.set("nodeName", "mention");
    const mentionAttrs = mention.getOrCreateContainer("attributes", new LoroMap());
    mentionAttrs.set("cardId", "target-1");
    mentionAttrs.set("label", "Target Card");
    doc.commit();

    const { container } = render(<StaticCardTitle cardDoc={doc} titleId={titleMap.id} />);
    expect(screen.queryByText("Untitled")).not.toBeInTheDocument();
    expect(container.querySelector(".mention-chip")).toHaveTextContent("@Target Card");
  });

  it("renders underline in formatted title", () => {
    const doc = new LoroDoc();
    doc.configTextStyle({ underline: { expand: "none" } });
    const titleMap = doc.getMap("titles").ensureMergeableMap("c1");
    titleMap.set("nodeName", "doc");
    const children = titleMap.getOrCreateContainer("children", new LoroList());
    const p = children.insertContainer(0, new LoroMap());
    p.set("nodeName", "paragraph");
    const pChildren = p.getOrCreateContainer("children", new LoroList());
    const text = pChildren.insertContainer(0, new LoroText());
    text.applyDelta([{ insert: "Underlined title", attributes: { underline: {} } }]);
    doc.commit();

    const { container } = render(<StaticCardTitle cardDoc={doc} titleId={titleMap.id} />);
    expect(container.querySelector("u")).toHaveTextContent("Underlined title");
  });
});

describe("StaticCardBody & StaticCardFace", () => {
  it("renders empty placeholder when body is empty and canEdit is true", () => {
    const doc = new LoroDoc();
    const contentMap = doc.getMap("content").ensureMergeableMap("c1");
    const { container } = render(
      <StaticCardBody cardDoc={doc} contentId={contentMap.id} canEdit={true} />,
    );

    const emptyP = container.querySelector(".is-editor-empty");
    expect(emptyP).toBeInTheDocument();
    expect(emptyP).toHaveAttribute("data-placeholder", BODY_PLACEHOLDER);
  });

  it("renders nothing when body is empty and canEdit is false", () => {
    const doc = new LoroDoc();
    const contentMap = doc.getMap("content").ensureMergeableMap("c1");
    const { container } = render(
      <StaticCardBody cardDoc={doc} contentId={contentMap.id} canEdit={false} />,
    );

    expect(container.querySelector(".is-editor-empty")).not.toBeInTheDocument();
  });

  it("always marks the body container contenteditable='false'", () => {
    const doc = new LoroDoc();
    const contentMap = doc.getMap("content").ensureMergeableMap("c1");
    const { container } = render(<StaticCardFace cardDoc={doc} contentId={contentMap.id} />);

    const editor = container.querySelector(".node-card-editor");
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveAttribute("contenteditable", "false");
  });

  it("renders rich text blocks: paragraphs, headings, blockquotes, lists, code block, hr", () => {
    const doc = new LoroDoc();
    doc.configTextStyle({
      strike: { expand: "none" },
    });
    const contentMap = doc.getMap("content").ensureMergeableMap("c1");
    contentMap.set("nodeName", "doc");
    const children = contentMap.getOrCreateContainer("children", new LoroList());

    // Heading
    const h1 = children.insertContainer(0, new LoroMap());
    h1.set("nodeName", "heading");
    const h1Attrs = h1.getOrCreateContainer("attributes", new LoroMap());
    h1Attrs.set("level", 1);
    const h1Children = h1.getOrCreateContainer("children", new LoroList());
    const h1Text = h1Children.insertContainer(0, new LoroText());
    h1Text.insert(0, "Heading 1");

    // Paragraph with strike and mention
    const p = children.insertContainer(1, new LoroMap());
    p.set("nodeName", "paragraph");
    const pChildren = p.getOrCreateContainer("children", new LoroList());
    const pText = pChildren.insertContainer(0, new LoroText());
    pText.applyDelta([
      { insert: "Before mention " },
      { insert: "strike text", attributes: { strike: {} } },
    ]);
    const mention = pChildren.insertContainer(1, new LoroMap());
    mention.set("nodeName", "mention");
    const mentionAttrs = mention.getOrCreateContainer("attributes", new LoroMap());
    mentionAttrs.set("cardId", "target-card-123");
    mentionAttrs.set("label", "Target Card");

    // Blockquote
    const bq = children.insertContainer(2, new LoroMap());
    bq.set("nodeName", "blockquote");
    const bqChildren = bq.getOrCreateContainer("children", new LoroList());
    const bqP = bqChildren.insertContainer(0, new LoroMap());
    bqP.set("nodeName", "paragraph");
    const bqPChildren = bqP.getOrCreateContainer("children", new LoroList());
    const bqText = bqPChildren.insertContainer(0, new LoroText());
    bqText.insert(0, "A wise quote");

    // Code block
    const cb = children.insertContainer(3, new LoroMap());
    cb.set("nodeName", "codeBlock");
    const cbChildren = cb.getOrCreateContainer("children", new LoroList());
    const cbText = cbChildren.insertContainer(0, new LoroText());
    cbText.insert(0, "console.log('hello');");

    // Bullet list
    const ul = children.insertContainer(4, new LoroMap());
    ul.set("nodeName", "bulletList");
    const ulChildren = ul.getOrCreateContainer("children", new LoroList());
    const li = ulChildren.insertContainer(0, new LoroMap());
    li.set("nodeName", "listItem");
    const liChildren = li.getOrCreateContainer("children", new LoroList());
    const liP = liChildren.insertContainer(0, new LoroMap());
    liP.set("nodeName", "paragraph");
    const liPChildren = liP.getOrCreateContainer("children", new LoroList());
    const liText = liPChildren.insertContainer(0, new LoroText());
    liText.insert(0, "First bullet item");

    // Horizontal rule
    const hr = children.insertContainer(5, new LoroMap());
    hr.set("nodeName", "horizontalRule");

    doc.commit();

    const { container } = render(<StaticCardFace cardDoc={doc} contentId={contentMap.id} />);

    expect(container.querySelector("h1")).toHaveTextContent("Heading 1");
    expect(container.querySelector("s")).toHaveTextContent("strike text");
    expect(container.querySelector(".mention-chip")).toHaveTextContent("@Target Card");
    expect(container.querySelector("blockquote")).toHaveTextContent("A wise quote");
    expect(container.querySelector("pre code")).toHaveTextContent("console.log('hello');");
    expect(container.querySelector("ul li")).toHaveTextContent("First bullet item");
    expect(container.querySelector("hr")).toBeInTheDocument();
  });

  it("updates reactively when Loro container changes", async () => {
    const doc = new LoroDoc();
    const contentMap = doc.getMap("content").ensureMergeableMap("c1");
    contentMap.set("nodeName", "doc");
    const children = contentMap.getOrCreateContainer("children", new LoroList());
    const p = children.insertContainer(0, new LoroMap());
    p.set("nodeName", "paragraph");
    const pChildren = p.getOrCreateContainer("children", new LoroList());
    const text = pChildren.insertContainer(0, new LoroText());
    text.insert(0, "Initial content");
    doc.commit();

    render(<StaticCardFace cardDoc={doc} contentId={contentMap.id} />);
    expect(screen.getByText("Initial content")).toBeInTheDocument();

    // Now update the text
    text.insert(15, " and updated!");
    doc.commit();

    await waitFor(() => {
      expect(screen.getByText("Initial content and updated!")).toBeInTheDocument();
    });
  });

  it("renders propertyBlock chip matching camelCase nodeName", () => {
    const doc = new LoroDoc();
    const contentMap = doc.getMap("content").ensureMergeableMap("c1");
    contentMap.set("nodeName", "doc");
    const children = contentMap.getOrCreateContainer("children", new LoroList());

    const pb = children.insertContainer(0, new LoroMap());
    pb.set("nodeName", "propertyBlock");
    const attrs = pb.getOrCreateContainer("attributes", new LoroMap());
    attrs.set("fieldId", "priority");
    doc.commit();

    const { container } = render(<StaticCardFace cardDoc={doc} contentId={contentMap.id} />);
    const chip = container.querySelector(".property-block-chip");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("[priority]");
  });

  it("renders image, attachment, and tour step preview chips", () => {
    const doc = new LoroDoc();
    const contentMap = doc.getMap("content").ensureMergeableMap("c1");
    contentMap.set("nodeName", "doc");
    const children = contentMap.getOrCreateContainer("children", new LoroList());

    // Image
    const img = children.insertContainer(0, new LoroMap());
    img.set("nodeName", "image");
    const imgAttrs = img.getOrCreateContainer("attributes", new LoroMap());
    imgAttrs.set("src", "https://example.com/photo.png");
    imgAttrs.set("alt", "Sample photo");

    // Attachment
    const att = children.insertContainer(1, new LoroMap());
    att.set("nodeName", "attachment");
    const attAttrs = att.getOrCreateContainer("attributes", new LoroMap());
    attAttrs.set("name", "document.pdf");

    // Tour step
    const tour = children.insertContainer(2, new LoroMap());
    tour.set("nodeName", "tourStep");
    const tourAttrs = tour.getOrCreateContainer("attributes", new LoroMap());
    tourAttrs.set("label", "Intro to Workspace");

    doc.commit();

    const { container } = render(<StaticCardFace cardDoc={doc} contentId={contentMap.id} />);
    const renderedImg = container.querySelector("img");
    expect(renderedImg).toBeInTheDocument();
    expect(renderedImg).toHaveAttribute("src", "https://example.com/photo.png");
    expect(renderedImg).toHaveAttribute("alt", "Sample photo");

    const attChip = container.querySelector(".attachment-chip");
    expect(attChip).toHaveTextContent("document.pdf");

    const tourChip = container.querySelector(".tour-step-chip");
    expect(tourChip).toHaveTextContent("Intro to Workspace");
  });

  it("renders blank paragraphs with a line break to preserve vertical rhythm", () => {
    const doc = new LoroDoc();
    const contentMap = doc.getMap("content").ensureMergeableMap("c1");
    contentMap.set("nodeName", "doc");
    const children = contentMap.getOrCreateContainer("children", new LoroList());

    // Paragraph 1
    const p1 = children.insertContainer(0, new LoroMap());
    p1.set("nodeName", "paragraph");
    const p1c = p1.getOrCreateContainer("children", new LoroList());
    const t1 = p1c.insertContainer(0, new LoroText());
    t1.insert(0, "First paragraph");

    // Paragraph 2 with empty text container
    const p2 = children.insertContainer(1, new LoroMap());
    p2.set("nodeName", "paragraph");
    const p2c = p2.getOrCreateContainer("children", new LoroList());
    const t2 = p2c.insertContainer(0, new LoroText());
    t2.insert(0, "");

    // Paragraph 3 with empty children
    const p3 = children.insertContainer(2, new LoroMap());
    p3.set("nodeName", "paragraph");

    // Paragraph 4
    const p4 = children.insertContainer(3, new LoroMap());
    p4.set("nodeName", "paragraph");
    const p4c = p4.getOrCreateContainer("children", new LoroList());
    const t4 = p4c.insertContainer(0, new LoroText());
    t4.insert(0, "Fourth paragraph");

    doc.commit();

    const { container } = render(<StaticCardFace cardDoc={doc} contentId={contentMap.id} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(4);
    // Middle paragraphs should contain <br> so they do not collapse to 0 height
    expect(paragraphs[1]?.querySelector("br")).toBeInTheDocument();
    expect(paragraphs[2]?.querySelector("br")).toBeInTheDocument();
  });
});

describe("StaticCardFace media", () => {
  const ID = "fedcba9876543210fedcba9876543210";

  /** A body holding exactly one media-ish block, built the way the document stores it. */
  function faceWith(
    nodeName: string,
    attrs: Record<string, string | number>,
  ): { container: HTMLElement } {
    const doc = new LoroDoc();
    const contentMap = doc.getMap("content").ensureMergeableMap("m1");
    contentMap.set("nodeName", "doc");
    const children = contentMap.getOrCreateContainer("children", new LoroList());
    const block = children.insertContainer(0, new LoroMap());
    block.set("nodeName", nodeName);
    const attributes = block.getOrCreateContainer("attributes", new LoroMap());
    for (const [key, value] of Object.entries(attrs)) attributes.set(key, value);
    block.getOrCreateContainer("children", new LoroList());
    doc.commit();

    return render(<StaticCardFace cardDoc={doc} contentId={contentMap.id} />);
  }

  it("draws an uploaded image from the relay instead of a paperclip", () => {
    const { container } = faceWith("media", {
      kind: "image",
      id: ID,
      mime: "image/png",
      name: "shot.png",
    });

    const image = container.querySelector("img");
    expect(image).toBeInTheDocument();
    expect(image?.getAttribute("src")).toContain(`/api/attachments/${ID}`);
    expect(image?.getAttribute("alt")).toBe("shot.png");
    // Lazy and async, because this face is drawn for every card in the viewport.
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
  });

  it("reserves the recorded size so a lazy image cannot reflow the card", () => {
    const { container } = faceWith("image", {
      src: "https://cdn.example.com/a.png",
      alt: "a.png",
      width: 800,
      height: 600,
    });

    const image = container.querySelector("img");
    expect(image).toHaveAttribute("width", "800");
    expect(image).toHaveAttribute("height", "600");
  });

  it("draws an attached video with its controls", () => {
    const { container } = faceWith("media", {
      kind: "video",
      id: ID,
      mime: "video/mp4",
      name: "clip.mp4",
    });

    const video = container.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("controls");
    expect(video?.getAttribute("src")).toContain(`/api/attachments/${ID}`);
  });

  it("reads a legacy attachment's mime to pick the renderer", () => {
    const { container } = faceWith("attachment", {
      id: ID,
      mime: "video/mp4",
      name: "clip.mp4",
    });

    expect(container.querySelector("video")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("draws a YouTube embed as a poster still, not an iframe per card", () => {
    const { container } = faceWith("youtube", { videoId: "dQw4w9WgXcQ" });

    const poster = container.querySelector('img[data-media-embed="youtube"]');
    expect(poster?.getAttribute("src")).toContain("i.ytimg.com/vi/dQw4w9WgXcQ");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("keeps a labelled chip when there is nothing to point at", () => {
    const { container } = faceWith("media", { kind: "image", name: "lost.png" });

    const chip = container.querySelector('[data-media-missing="image"]');
    expect(chip).toBeInTheDocument();
    expect(chip?.textContent).toContain("lost.png");
  });
});

describe("StaticCardFace caret slot", () => {
  /** A body of one paragraph followed by `last`, or just the paragraph when null. */
  function faceEnding(last: string | null, canEdit = true): HTMLElement {
    const doc = new LoroDoc();
    const content = doc.getMap("content").ensureMergeableMap("t1");
    content.set("nodeName", "doc");
    const children = content.getOrCreateContainer("children", new LoroList());
    const p = children.insertContainer(0, new LoroMap());
    p.set("nodeName", "paragraph");
    p.getOrCreateContainer("children", new LoroList())
      .insertContainer(0, new LoroText())
      .insert(0, "Hello");

    if (last !== null) {
      const block = children.insertContainer(1, new LoroMap());
      block.set("nodeName", last);
      if (last === "media") {
        block.getOrCreateContainer("attributes", new LoroMap()).set("kind", "image");
      }
      if (last === "heading") {
        block.getOrCreateContainer("attributes", new LoroMap()).set("level", 2);
      }
      const inner = block.getOrCreateContainer("children", new LoroList());
      const innerP = inner.insertContainer(0, new LoroMap());
      innerP.set("nodeName", "paragraph");
      innerP
        .getOrCreateContainer("children", new LoroList())
        .insertContainer(0, new LoroText())
        .insert(0, "last");
    }
    doc.commit();

    return render(<StaticCardFace cardDoc={doc} contentId={content.id} canEdit={canEdit} />)
      .container;
  }

  /** The top-level blocks the face drew. */
  function drawnBlocks(container: HTMLElement): number {
    return container.querySelector(".node-card-editor")?.childElementCount ?? 0;
  }

  it("draws the empty paragraph the editor will add, so focusing moves nothing", () => {
    // The editor ends a body with a paragraph; leaving it out meant the card grew a
    // line the first time it was written in, and shrank back on blur.
    // paragraph + media, then the caret paragraph the editor will add.
    expect(drawnBlocks(faceEnding("media"))).toBe(3);
    expect(drawnBlocks(faceEnding("heading"))).toBe(3);
  });

  it("adds nothing when the body already ends on a paragraph", () => {
    expect(drawnBlocks(faceEnding(null))).toBe(1);
  });

  it("adds nothing for a reader who cannot write there", () => {
    expect(drawnBlocks(faceEnding("media", false))).toBe(2);
  });
});
