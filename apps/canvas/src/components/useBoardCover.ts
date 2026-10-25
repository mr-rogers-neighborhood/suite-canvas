import type { CardAttachment } from "@suite/graph";
import { documentAttachments } from "@suite/graph";
import { useEffect, useState } from "react";
import { attachmentBlob, attachmentUrl, readLocalAttachment } from "../editor/attachmentNode";
import { useCanvasStore } from "../store/useCanvasStore";

/** The image attachments a cover can be chosen from. */
export function useCoverCandidates(): CardAttachment[] {
  const workspace = useCanvasStore((state) => state.workspace);
  // An attachment only exists if a card body references it, so this is the same
  // walk the export does — one inventory, not a second store of image ids.
  try {
    return documentAttachments(workspace).filter((entry) =>
      entry.mime ? entry.mime.startsWith("image/") : false,
    );
  } catch {
    return [];
  }
}

/**
 * One attachment's bytes as a displayable URL, or null while it loads.
 *
 * It mirrors `AttachmentView` deliberately: local bytes win (they are what the
 * user just pasted), the relay is the fallback, and the object URL is revoked
 * when the id changes so a board's cover cannot leak.
 */
export function useAttachmentSource(id: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    setSrc(null);
    if (!id) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    void readLocalAttachment(id)
      .then((local) => {
        if (cancelled) return;
        if (local && typeof URL.createObjectURL === "function") {
          objectUrl = URL.createObjectURL(attachmentBlob(local.bytes, local.mime ?? "image/png"));
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
  }, [id]);

  return src;
}
