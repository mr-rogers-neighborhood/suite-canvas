import { useEffect, useState } from "react";
import { MEDIA_NODE_NAME } from "../editor/mediaNode";
import { useCanvasStore } from "../store/useCanvasStore";
import { workspaceSnapshotStore } from "../store/workspaceSnapshotStore";
import { BookReader } from "./BookReader";

/**
 * Reading a book card in focus mode.
 *
 * The focus surface already means "this card, large, with the chrome still live", and a whiteboard already takes
 * that branch. A book does the same, for one more reason: here the reader is a plain surface, so selecting a
 * sentence is a selection rather than a fight with an editor, and the reading session survives every transaction
 * that replaces the block in the card's body.
 *
 * The block is found the way the editor finds it — one `media` node of kind `epub` in the body — rather than in
 * React state, so a card whose book changed while it is open shows the book it has.
 */
export function BookFocus({ cardId }: { cardId: string }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const [block, setBlock] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (workspace === null) {
      setBlock(null);
      return;
    }
    const read = () => setBlock(bookBlockOf(workspace, cardId));
    read();
    // The body of a card is a rich-text container, so a peer adding or replacing the book is a change this
    // surface has to notice; the card change stream is how every other reader of a body hears about one.
    const stop = workspaceSnapshotStore(workspace).subscribeCardChanges((changed) => {
      if (changed.includes(cardId)) read();
    });
    return stop;
  }, [workspace, cardId]);

  if (block === null) {
    return (
      <p className="reader-note" data-testid="book-focus-empty">
        This card has no book in it.
      </p>
    );
  }

  return (
    <div className="book-focus" data-testid="book-focus">
      <BookReader attachmentId={block.id} name={block.name} sourceCardId={cardId} />
    </div>
  );
}

/** The first `media` block of kind `epub` in a card's body, or null. */
function bookBlockOf(
  workspace: NonNullable<ReturnType<typeof useCanvasStore.getState>["workspace"]>,
  cardId: string,
): { id: string; name: string } | null {
  const nodes = workspace.bodyNodes(cardId);
  for (const node of nodes) {
    if (node.type !== MEDIA_NODE_NAME) continue;
    const attrs = node.attrs ?? {};
    if (attrs.kind !== "epub") continue;
    // The block's `mime` is a hint the reader does not need: the archive itself is the truth, and `openEpub`
    // refuses a file that is not one. Reading the hint here would turn away a book whose upload recorded
    // `application/octet-stream`, which some platforms report for a perfectly good `.epub`.
    return {
      id: typeof attrs.id === "string" ? attrs.id : "",
      name: typeof attrs.name === "string" ? attrs.name : "Untitled book",
    };
  }
  return null;
}
