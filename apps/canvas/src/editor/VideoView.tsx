import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useEffect, useState } from "react";
import { isStandalone } from "../session/mode";
import { attachmentBlob, attachmentUrl, readLocalAttachment } from "./attachmentNode";

export function VideoView({ node, selected }: NodeViewProps) {
  const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
  const name = typeof node.attrs.name === "string" ? node.attrs.name : "Video";
  const mime = typeof node.attrs.mime === "string" ? node.attrs.mime : "video/mp4";
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (!id) return;

    if (isStandalone() || (typeof navigator !== "undefined" && !navigator.onLine)) {
      void readLocalAttachment(id).then((record) => {
        if (!active) return;
        if (record) {
          const blob = attachmentBlob(record.bytes, record.mime);
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        } else {
          setSrc(attachmentUrl(id));
        }
      });
    } else {
      setSrc(attachmentUrl(id));
    }

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  return (
    <NodeViewWrapper
      className={`relative my-2 w-full max-w-full overflow-hidden rounded-lg border transition-all ${
        selected
          ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/20"
          : "border-[var(--hairline)]"
      }`}
    >
      {src ? (
        // biome-ignore lint/a11y/useMediaCaption: user uploaded video
        <video controls src={src} className="card-media-video w-full bg-black" preload="metadata">
          <source src={src} type={mime} />
          Your browser does not support the video tag.
        </video>
      ) : (
        <div className="flex h-36 w-full items-center justify-center bg-[var(--surface-muted)] text-[12px] text-[var(--ink-muted)]">
          Loading video…
        </div>
      )}
      {name ? (
        <div className="truncate px-2 py-1 text-[11px] text-[var(--ink-muted)]">{name}</div>
      ) : null}
    </NodeViewWrapper>
  );
}
