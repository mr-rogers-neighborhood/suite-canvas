import type { NodeViewProps } from "@tiptap/react";
import { AttachmentView } from "./AttachmentView";
import { ImageLinkView } from "./ImageLinkView";
import { hasStoredBytes, mediaKindOf } from "./mediaNode";
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
  const kind = mediaKindOf(props.node.attrs.kind);

  if (kind === "youtube") return <YouTubeView {...props} />;
  if (kind === "video") return <VideoView {...props} />;

  return hasStoredBytes(props.node.attrs) ? (
    <AttachmentView {...props} />
  ) : (
    <ImageLinkView {...props} />
  );
}
