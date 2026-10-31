import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import { useEffect, useState } from "react";
import { bookEntries, zipOf } from "../archive/epub/fixture";
import { useCanvasStore } from "../store/useCanvasStore";
import { BookReader } from "./BookReader";

/**
 * A book assembled in the story, for the same reason the tests assemble one: a real book is somebody else's
 * copyright and a large binary. The reader is handed the bytes directly, which is the seam a preview needs and no
 * production surface uses.
 */
function Reader() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);

  useEffect(() => {
    const doc = new WorkspaceDocument();
    doc.ensureDefaultTypes();
    const board = doc.ensureBoard();
    doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    doc.ensureAnnotationStyles();
    useCanvasStore.setState({ workspace: doc });
    void zipOf(bookEntries()).then(setBytes);
  }, []);

  return (
    <div style={{ height: 540, width: 760, padding: 12 }}>
      {bytes === null ? (
        <p>Assembling the book…</p>
      ) : (
        <BookReader
          attachmentId={"a".repeat(32)}
          mime="application/epub+zip"
          name="A Small Book"
          source={{ status: "ready", bytes }}
        />
      )}
    </div>
  );
}

const meta = {
  title: "Reading/BookReader",
  component: Reader,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Reader>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A book open on its first chapter: the header, the contents toggle, and the text in our own type. */
export const FirstChapter: Story = {};
