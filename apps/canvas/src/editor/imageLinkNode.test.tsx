import { type RichTextSnapshot, validateRichTextTree } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type Editor, EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { IMAGE_NODE_NAME, ImageLink } from "./imageLinkNode";

const SRC = "https://cdn.example.com/diagrams/relay.png";

function extensions() {
  return [StarterKit.configure({ undoRedo: false }), ImageLink];
}

function body(attrs: Record<string, unknown>): JSONContent {
  return { type: "doc", content: [{ type: IMAGE_NODE_NAME, attrs }] };
}

function Harness({
  content,
  onEditor,
}: {
  content: JSONContent;
  onEditor?: (editor: Editor) => void;
}) {
  const editor = useEditor({ extensions: extensions(), content });
  if (!editor) return null;
  onEditor?.(editor);
  return <EditorContent editor={editor} />;
}

describe("image link node", () => {
  it("renders the picture without a referrer and without blocking the card", async () => {
    render(<Harness content={body({ src: SRC, alt: "Relay diagram" })} />);

    const image = await screen.findByAltText("Relay diagram");
    expect(image.getAttribute("src")).toBe(SRC);
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("decoding")).toBe("async");
    expect(image.getAttribute("title")).toBe("Relay diagram");
  });

  it("shows the URL and says why when the picture does not load", async () => {
    render(<Harness content={body({ src: SRC, alt: "Relay diagram" })} />);

    const image = await screen.findByAltText("Relay diagram");
    fireEvent.error(image);

    const placeholder = await screen.findByText(SRC);
    expect(placeholder.textContent).toBe(SRC);
    expect(
      placeholder
        .closest("[data-image-link-placeholder]")
        ?.getAttribute("data-image-link-placeholder"),
    ).toBe("broken");
    expect(screen.getByText(/may be broken, moved, or hotlink-blocked/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByAltText("Relay diagram")).toBeNull());
  });

  it("never hands a hostile scheme to the browser", async () => {
    render(<Harness content={body({ src: "javascript:alert(1)", alt: "nope" })} />);

    const raw = await screen.findByText("javascript:alert(1)");
    expect(
      raw.closest("[data-image-link-placeholder]")?.getAttribute("data-image-link-placeholder"),
    ).toBe("invalid");
    expect(screen.getByText("Only http and https links can be shown.")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("serializes the link, never bytes, and keeps the privacy attributes in HTML", async () => {
    const holder: { editor: Editor | null } = { editor: null };
    render(
      <Harness
        content={body({ src: SRC, alt: "Relay diagram", width: 320, height: 180 })}
        onEditor={(value) => {
          holder.editor = value;
        }}
      />,
    );
    await screen.findByAltText("Relay diagram");

    const json = JSON.stringify(holder.editor?.getJSON());
    expect(json).toContain(SRC);
    expect(json).not.toContain("data:image");

    const html = holder.editor?.getHTML() ?? "";
    expect(html).toContain(`src="${SRC}"`);
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('loading="lazy"');
  });
});

describe("publishing an image link node", () => {
  function tree(attributes: Record<string, unknown>): RichTextSnapshot {
    return {
      nodeName: "doc",
      children: [{ nodeName: IMAGE_NODE_NAME, attributes }],
    } as unknown as RichTextSnapshot;
  }

  it("should accept an http or https link with a short label", () => {
    expect(validateRichTextTree(tree({ src: SRC, alt: "Relay diagram" }))).toBeNull();
    expect(validateRichTextTree(tree({ src: "http://example.com/a.png", alt: "" }))).toBeNull();
    expect(
      validateRichTextTree(tree({ src: SRC, alt: "sized", width: 40, height: 30 })),
    ).toBeNull();
  });

  it("should refuse every scheme that could execute or read the disk", () => {
    expect(validateRichTextTree(tree({ src: "javascript:alert(1)" }))).toContain(
      "uses the javascript: scheme; only http and https image links are allowed",
    );
    expect(validateRichTextTree(tree({ src: "data:image/png;base64,AAAA" }))).toContain(
      "uses the data: scheme; an image link is a URL, never inlined bytes",
    );
    expect(validateRichTextTree(tree({ src: "file:///etc/passwd" }))).toContain(
      "uses the file: scheme; only http and https image links are allowed",
    );
    expect(validateRichTextTree(tree({ src: "/relative.png" }))).toContain(
      "is not an http or https URL",
    );
    expect(validateRichTextTree(tree({ src: "https://exa mple.com/a.png" }))).toContain(
      "contains whitespace or a control character",
    );
  });

  it("should refuse an empty or over-long link and an over-long label", () => {
    expect(validateRichTextTree(tree({ src: "" }))).toContain(
      "is empty; an image link needs an http or https URL",
    );
    expect(validateRichTextTree(tree({ src: null }))).toContain(
      "is empty; an image link needs an http or https URL",
    );
    const long = `https://example.com/${"a".repeat(2100)}.png`;
    expect(validateRichTextTree(tree({ src: long }))).toContain("is longer than 2048 characters");
    expect(validateRichTextTree(tree({ src: SRC, alt: "a".repeat(201) }))).toContain(
      "is longer than 200 bytes",
    );
  });
});
