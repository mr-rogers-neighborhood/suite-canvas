import { useEffect, useState } from "react";
import {
  ATTACHMENT_ID_PATTERN,
  attachmentUrl,
  readLocalAttachment,
} from "../editor/attachmentNode";
import { isStandalone } from "../session/mode";

/**
 * A book's bytes, from wherever this browser can reach them.
 *
 * The same order every attachment uses: IndexedDB first, the relay second. That order is why a reader works on
 * a plane, and why a book somebody just dropped onto a board opens before it has finished uploading.
 */
export type BookBytes =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly bytes: Uint8Array }
  | { readonly status: "missing"; readonly reason: string };

export function useBookBytes(attachmentId: string): BookBytes {
  const [state, setState] = useState<BookBytes>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) {
      setState({ status: "missing", reason: "This block does not name a stored book." });
      return;
    }

    const fromRelay = async (): Promise<BookBytes> => {
      // A standalone build has no relay to ask, and the local copy is the only copy there is.
      if (isStandalone()) {
        return { status: "missing", reason: "This book's bytes are not on this device." };
      }
      try {
        const response = await fetch(attachmentUrl(attachmentId));
        if (!response.ok) {
          return {
            status: "missing",
            reason:
              response.status === 404
                ? "The book's bytes are not on this device or the relay yet."
                : `The relay answered ${String(response.status)}.`,
          };
        }
        return { status: "ready", bytes: new Uint8Array(await response.arrayBuffer()) };
      } catch {
        return {
          status: "missing",
          reason: "The relay could not be reached, and there is no local copy.",
        };
      }
    };

    void readLocalAttachment(attachmentId)
      .then((local) =>
        local === null ? fromRelay() : { status: "ready" as const, bytes: local.bytes },
      )
      .catch(fromRelay)
      .then((next) => {
        if (!cancelled) setState(next);
      });

    return () => {
      cancelled = true;
    };
  }, [attachmentId]);

  return state;
}
