import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useEffect, useState } from "react";
import { isStandalone } from "../session/mode";
import {
  ATTACHMENT_ID_PATTERN,
  type AttachmentUploadState,
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

/** The words a local-only image shows. Collaboration must never be silently assumed. */
export const PENDING_UPLOAD_NOTICE =
  "Not uploaded yet. Collaborators see a placeholder until it is.";

const FRAME_STYLE = {
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "flex-start",
  verticalAlign: "top",
  maxWidth: "100%",
} as const;

/**
 * A readable width, not the image's width: an 8px icon would otherwise wrap one
 * character per line into a two-thousand-pixel column. A wide image keeps its
 * own measure (the column is the image), and the caption wraps inside this cap,
 * so only the line box grows — never the card's horizontal measure.
 */
const CAPTION_STYLE = {
  width: "14rem",
  maxWidth: "100%",
  marginTop: 2,
  color: "var(--ink-muted)",
  fontSize: 11,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
} as const;

export interface AttachmentFrameProps {
  /** False when the node carries no id at all, so no bytes could exist. */
  known: boolean;
  /** The image source, or null while it is still being resolved. */
  src: string | null;
  /** True once the chosen source refused the bytes. */
  failed: boolean;
  /** Called when the image itself refuses to load. */
  onFailed?: (() => void) | undefined;
  /** True only where this reader can act on the fact: a relay-backed build. */
  pending: boolean;
  label: string;
  width: number | null;
  height: number | null;
}

/**
 * The drawn node: the image (or its placeholder) and, when the bytes have not
 * reached a relay, one quiet line that says so. Presentational, so a story can
 * pin the pending state without an IndexedDB or a relay.
 */
export function AttachmentFrame({
  known,
  src,
  failed,
  onFailed,
  pending,
  label,
  width,
  height,
}: AttachmentFrameProps) {
  const showImage = known && src !== null && !failed;

  return (
    <span className="attachment-frame" style={FRAME_STYLE}>
      {showImage ? (
        <img
          src={src}
          alt={label}
          title={label}
          className="attachment-image"
          draggable={false}
          {...(width === null ? {} : { width })}
          {...(height === null ? {} : { height })}
          onError={onFailed}
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
      {pending ? (
        <span
          className="attachment-pending"
          data-attachment-upload-state="local"
          style={CAPTION_STYLE}
        >
          {PENDING_UPLOAD_NOTICE}
        </span>
      ) : null}
    </span>
  );
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
 *
 * When the local copy says the bytes never reached a relay, the node says so.
 * That fact is stored beside the bytes (`uploadState`), so it survives a reload
 * and cannot be inferred from "there is a local copy" alone, which is also true
 * after a successful upload. A standalone build hides the line: it has no relay
 * by design, so there is nothing the reader could do about it.
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
  const [uploadState, setUploadState] = useState<AttachmentUploadState>("unknown");

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    setSrc(null);
    setUploadState("unknown");
    if (!ATTACHMENT_ID_PATTERN.test(id)) return;

    void readLocalAttachment(id)
      .then((local) => {
        if (cancelled) return;
        if (local) setUploadState(local.uploadState);
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
  const pending = !isStandalone() && uploadState === "local";

  return (
    <NodeViewWrapper as="span" className="attachment-node" contentEditable={false}>
      <AttachmentFrame
        known={known}
        src={src}
        failed={failed}
        onFailed={() => setFailed(true)}
        pending={pending}
        label={label}
        width={width}
        height={height}
      />
    </NodeViewWrapper>
  );
}
