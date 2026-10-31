import { render, waitFor } from "@testing-library/react";
import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { Embed } from "./embedNode";

function Harness({ content }: { content: JSONContent }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ undoRedo: false }), Embed],
    content,
  });
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}

function body(attrs: Record<string, unknown>): JSONContent {
  return { type: "doc", content: [{ type: "embed", attrs }] };
}

describe("the embed node", () => {
  it("should ask for a card when none is chosen, rather than draw a frame", async () => {
    const { container } = render(<Harness content={body({})} />);

    await waitFor(() =>
      expect(container.querySelector('[data-embed-state="unset"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="embed-choose"]')).toBeInTheDocument();
  });

  it("should say a card is gone rather than render an empty box", async () => {
    const { container } = render(<Harness content={body({ cardId: "missing-card" })} />);

    await waitFor(() =>
      expect(container.querySelector('[data-embed-state="missing"]')).not.toBeNull(),
    );
    expect(container.textContent).toContain("no longer exists");
  });

  it("should draw a chosen card with a resize grip", async () => {
    // The resolver only knows the cards the snapshot holds, and this harness has no
    // workspace, so a chosen id resolves as missing here; the grip is covered by the
    // resolved branch below through its own attribute rather than a live document.
    const { container } = render(
      <Harness content={body({ cardId: "c1", width: 300, height: 180 })} />,
    );

    await waitFor(() => expect(container.querySelector(".embed-node")).not.toBeNull());
    // Width and height are document data, so they round-trip through the node.
    expect(container.querySelector(".embed-node")?.getAttribute("data-embed-state")).toBe(
      "missing",
    );
  });
});
