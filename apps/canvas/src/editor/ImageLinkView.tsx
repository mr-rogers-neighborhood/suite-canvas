import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useState } from "react";
import { imageLinkProblem, imageLinkSrc } from "./imageLinkNode";

export interface ImageLinkFrameProps {
  /** The address to load, normalized; null when the stored value is not a link. */
  src: string | null;
  /** The stored value as the document holds it, shown when `src` is null. */
  rawSrc?: string | undefined;
  alt: string;
  width: number | null;
  height: number | null;
  /** Why this value is not renderable, in the prompt's words. */
  problem?: string | undefined;
  /**
   * Start in the failed state. The real failure needs a network the story
   * runner does not have, so the broken placeholder is pinned by the story.
   */
  broken?: boolean | undefined;
}

function size(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The picture, or the placeholder that says why there is none.
 *
 * A link is only a promise: the bytes belong to a third party who may have
 * moved them, deleted them, or refuse to serve them to anyone but their own
 * site. So the failure state is a first-class view, not an error toast, and it
 * always shows the URL — a reader who cannot see the image can still see where
 * it pointed, and paste it somewhere that works.
 */
export function ImageLinkFrame({
  src,
  rawSrc,
  alt,
  width,
  height,
  problem,
  broken = false,
}: ImageLinkFrameProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(broken ? src : null);
  const failed = src !== null && failedSrc === src;

  if (src === null || failed) {
    return (
      <div
        className="image-link-placeholder"
        data-image-link-placeholder={src === null ? "invalid" : "broken"}
      >
        <span className="image-link-placeholder-title" aria-hidden="true">
          {"\u{1f5bc}"} Image link
        </span>
        <span className="image-link-url">{src ?? rawSrc ?? "no usable address"}</span>
        <span className="image-link-placeholder-note">
          {problem ??
            (src === null
              ? "Only http and https links can be shown."
              : "This link may be broken, moved, or hotlink-blocked.")}
        </span>
      </div>
    );
  }

  return (
    <img
      className="image-link-image"
      src={src}
      alt={alt}
      title={alt || src}
      width={width ?? undefined}
      height={height ?? undefined}
      // A remote image is fetched by the reader's browser, which tells the
      // third-party host their IP and the page they are on. The document-wide
      // referrer policy covers navigation; this attribute covers the request
      // the picture itself makes.
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailedSrc(src)}
    />
  );
}

/** One link image in a card body; reads the node's attrs into the frame. */
export function ImageLinkView({ node }: NodeViewProps) {
  const src = imageLinkSrc(node.attrs.src);
  const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
  const problem = imageLinkProblem(node.attrs.src);

  return (
    <NodeViewWrapper as="div" className="image-link-node" contentEditable={false}>
      <ImageLinkFrame
        src={src}
        {...(problem === null ? {} : { problem })}
        rawSrc={typeof node.attrs.src === "string" ? node.attrs.src : undefined}
        alt={alt}
        width={size(node.attrs.width)}
        height={size(node.attrs.height)}
      />
    </NodeViewWrapper>
  );
}
