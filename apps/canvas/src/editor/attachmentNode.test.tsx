import { type RichTextSnapshot, validateRichTextTree } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type Editor, EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { ATTACHMENT_NODE_NAME, Attachment } from "./attachmentNode";

const ID = "0123456789abcdef0123456789abcdef";

function extensions() {
  return [StarterKit.configure({ undoRedo: false }), Attachment];
}

function body(attrs: Record<string, unknown>): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: ATTACHMENT_NODE_NAME, attrs }] }],
  };
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

describe("attachment node", () => {
  it("renders the image from the relay, with the name as its alt text", async () => {
    render(
      <Harness
        content={body({
          id: ID,
          mime: "image/png",
          width: 40,
          height: 30,
          name: "diagram.png",
          bytes: 1234,
        })}
      />,
    );

    const image = await screen.findByAltText("diagram.png");
    expect(image.getAttribute("src")).toContain(`/api/attachments/${ID}`);
    expect(image.getAttribute("width")).toBe("40");
    expect(image.getAttribute("height")).toBe("30");
  });

  it("renders the placeholder, not an error, when the bytes cannot be reached", async () => {
    render(
      <Harness content={body({ id: ID, mime: "image/png", name: "diagram.png", bytes: 12 })} />,
    );

    const image = await screen.findByAltText("diagram.png");
    // The relay (or the local copy) has nothing to answer with for this id.
    fireEvent.error(image);

    const placeholder = await screen.findByRole("img", {
      name: "diagram.png (not available here)",
    });
    expect(placeholder.getAttribute("data-attachment-placeholder")).toBe("missing");
    expect(placeholder.textContent).toContain("diagram.png");
    expect(placeholder.textContent).toContain("the image bytes are not available here");
    await waitFor(() => expect(screen.queryByAltText("diagram.png")).toBeNull());
  });

  it("renders a placeholder for a node with no id at all", async () => {
    render(<Harness content={body({ id: null, mime: "image/png", name: null, bytes: null })} />);

    const placeholder = await screen.findByRole("img", {
      name: "Attached image (not available here)",
    });
    expect(placeholder.getAttribute("data-attachment-placeholder")).toBe("unlinked");
    expect(placeholder.textContent).toContain("this image has no stored reference");
  });

  it("keeps the document metadata only, and serializes the metadata plus the URL", async () => {
    const holder: { editor: Editor | null } = { editor: null };
    render(
      <Harness
        content={body({ id: ID, mime: "image/png", name: "diagram.png", bytes: 1234 })}
        onEditor={(value) => {
          holder.editor = value;
        }}
      />,
    );
    await screen.findByAltText("diagram.png");

    const json = JSON.stringify(holder.editor?.getJSON());
    expect(json).toContain(ID);
    // The document names the bytes; it never holds them.
    expect(json).not.toContain("data:image");

    const html = holder.editor?.getHTML() ?? "";
    expect(html).toContain(`data-attachment-id="${ID}"`);
    expect(html).toContain('data-attachment-mime="image/png"');
    expect(html).toContain('alt="diagram.png"');
    expect(html).toContain(`/api/attachments/${ID}`);
  });
});

describe("publishing an attachment node", () => {
  function tree(attributes: Record<string, unknown>): RichTextSnapshot {
    return {
      nodeName: "doc",
      children: [
        { nodeName: "paragraph", children: [{ nodeName: ATTACHMENT_NODE_NAME, attributes }] },
      ],
    } as unknown as RichTextSnapshot;
  }

  it("accepts the metadata a structured paste writes", () => {
    expect(
      validateRichTextTree(
        tree({
          id: ID,
          mime: "image/png",
          width: 40,
          height: 30,
          name: "diagram.png",
          bytes: 1234,
        }),
      ),
    ).toBeNull();
  });

  it("refuses an id the relay could not have issued and a type it would not serve", () => {
    expect(
      validateRichTextTree(tree({ id: "https://example.com/a.png", mime: "image/png" })),
    ).toContain("is not an attachment id");
    expect(validateRichTextTree(tree({ id: ID, mime: "image/svg+xml" }))).toContain(
      "is not an image type the relay serves",
    );
  });
});
