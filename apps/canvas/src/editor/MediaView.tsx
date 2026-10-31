import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { AttachmentView } from "./AttachmentView";
import { BookView } from "./BookView";
import { ImageLinkView } from "./ImageLinkView";
import { hasStoredBytes, isKnownMediaKind, mediaKindOf } from "./mediaNode";
import { VideoView } from "./VideoView";
import { YouTubeView } from "./YouTubeView";

/**
 * The drawn media block: whichever of the four renderers fits what the node holds.
 *
 * Every renderer takes `NodeViewProps` and reads the attributes it needs by
 * name, and `media` carries the union of them, so this is a router rather than
 * a fifth renderer. A block the four did not all agree on (an image is an
 * inline chip in one, a block in another) resolves to the block-shaped view
 * that matches its data.
 *
 * An image splits on where its bytes are: an id means they live beside the
 * document and `AttachmentView` owns the local-first resolution and the
 * upload-state notice; a plain address means a third party serves it and
 * `ImageLinkView` owns the referrer and the honest failure state.
 */
export function MediaView(props: NodeViewProps) {
  // The raw attribute first: a block written by a build that knows a kind this one does not is not a broken
  // image, and saying so is better than drawing one.
  if (!isKnownMediaKind(props.node.attrs.kind)) return <UnknownMediaView {...props} />;
  const kind = mediaKindOf(props.node.attrs.kind);

  if (kind === "epub") {
    // The card that owns the editor is what a highlight is recorded against.
    const cardId = (props.extension.options as { cardId?: string }).cardId ?? "";
    return <BookView {...props} sourceCardId={cardId} />;
  }
  if (kind === "youtube") return <YouTubeView {...props} />;
  if (kind === "video") return <VideoView {...props} />;

  return hasStoredBytes(props.node.attrs) ? (
    <AttachmentView {...props} />
  ) : (
    <ImageLinkView {...props} />
  );
}

/** A media block this build has no renderer for. The block is left alone; only the drawing is a sentence. */
function UnknownMediaView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper as="div" className="media-node" contentEditable={false}>
      <p className="rounded border border-dashed border-[var(--hairline)] p-3 text-[11px] text-[var(--ink-muted)]">
        This block is a {String(node.attrs.kind ?? "media")} this build cannot show. It is still in
        the card.
      </p>
    </NodeViewWrapper>
  );
}
