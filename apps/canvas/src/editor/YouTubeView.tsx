import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";

export function YouTubeView({ node, selected }: NodeViewProps) {
  const videoId = typeof node.attrs.videoId === "string" ? node.attrs.videoId : "";
  const title = typeof node.attrs.title === "string" ? node.attrs.title : "YouTube video";
  const src =
    typeof node.attrs.src === "string" && node.attrs.src.length > 0
      ? node.attrs.src
      : `https://www.youtube-nocookie.com/embed/${videoId}`;

  return (
    <NodeViewWrapper
      className={`relative my-2 w-full max-w-full overflow-hidden rounded-lg border transition-all ${
        selected
          ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/20"
          : "border-[var(--hairline)]"
      }`}
      style={{ aspectRatio: "16/9" }}
    >
      {videoId ? (
        <iframe
          src={src}
          title={title}
          className="h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[var(--surface-muted)] text-[12px] text-[var(--ink-muted)]">
          Invalid YouTube video
        </div>
      )}
    </NodeViewWrapper>
  );
}
