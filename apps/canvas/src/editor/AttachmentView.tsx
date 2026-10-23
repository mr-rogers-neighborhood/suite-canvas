import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useEffect, useState } from "react";
import {
  ATTACHMENT_ID_PATTERN,
  attachmentBlob,
  attachmentUrl,
  readLocalAttachment,
} from "./attachmentNode";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function size(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * One image in a card body.
 *
 * The bytes are never in the document, so the view resolves them at render time:
 * the browser's own copy first (an offline or standalone paste lives only there),
 * then the relay by id. If neither answers — a share viewer offline, a node whose
 * row was garbage-collected, a copied node in a build without a relay — the node
 * draws a placeholder with the image's name instead of an error. Rendering must
 * never throw: it happens inside a CRDT-backed editor that every peer replicates.
 */
export function AttachmentView({ node }: NodeViewProps) {
  const id = text(node.attrs.id);
  const name = text(node.attrs.name);
  const mime = text(node.attrs.mime);
  const width = size(node.attrs.width);
  const height = size(node.attrs.height);

  // Null while the local copy is being looked for: a standalone build must not
  // flash a broken remote image before IndexedDB answers.
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    setSrc(null);
    if (!ATTACHMENT_ID_PATTERN.test(id)) return;

    void readLocalAttachment(id)
      .then((local) => {
        if (cancelled) return;
        if (local && typeof URL.createObjectURL === "function") {
          objectUrl = URL.createObjectURL(attachmentBlob(local.bytes, local.mime || mime));
          setSrc(objectUrl);
          return;
        }
        setSrc(attachmentUrl(id));
      })
      .catch(() => {
        if (!cancelled) setSrc(attachmentUrl(id));
      });

    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [id, mime]);

  const label = name || "Attached image";
  const known = ATTACHMENT_ID_PATTERN.test(id);
  const showImage = known && src !== null && !failed;

  return (
    <NodeViewWrapper as="span" className="attachment-node" contentEditable={false}>
      {showImage ? (
        <img
          src={src}
          alt={label}
          title={label}
          className="attachment-image"
          draggable={false}
          {...(width === null ? {} : { width })}
          {...(height === null ? {} : { height })}
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          className="attachment-placeholder"
          role="img"
          aria-label={`${label} (not available here)`}
          data-attachment-placeholder={known ? "missing" : "unlinked"}
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <span aria-hidden="true">🖼</span>
          <span>{label}</span>
          <span style={{ opacity: 0.7 }}>
            {!known
              ? "— this image has no stored reference"
              : failed
                ? "— the image bytes are not available here"
                : "— loading image…"}
          </span>
        </span>
      )}
    </NodeViewWrapper>
  );
}
