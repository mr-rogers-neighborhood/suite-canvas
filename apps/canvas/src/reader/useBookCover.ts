import { useEffect, useState } from "react";
import { openEpub } from "../archive/epub/open";
import type { BookBytes } from "./useBookBytes";

/**
 * What a book says about itself, without reading it.
 *
 * A cover, a title and an author come from the package: a few kilobytes of XML at the front of the archive, not
 * the chapters. That is what makes a card able to draw a book the way it draws a picture — the expensive part is
 * deferred until somebody presses Read.
 */
export interface BookCover {
  readonly title: string;
  readonly creator: string | null;
  readonly language: string | null;
  readonly chapters: number;
  /** A blob URL for the declared cover image, or null. Revoked when the hook unmounts. */
  readonly coverUrl: string | null;
}

export type CoverState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly cover: BookCover }
  | { readonly status: "refused"; readonly reason: string };

export function useBookCover(bytes: BookBytes): CoverState {
  const [state, setState] = useState<CoverState>({ status: "loading" });

  useEffect(() => {
    if (bytes.status === "loading") {
      setState({ status: "loading" });
      return;
    }
    if (bytes.status === "missing") {
      setState({ status: "refused", reason: bytes.reason });
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void openEpub(bytes.bytes)
      .then(async (opened) => {
        if (cancelled) return;
        if (opened.book.coverPath !== null) {
          const image = await opened.readResource(opened.book.coverPath);
          if (image !== null && typeof URL.createObjectURL === "function") {
            objectUrl = URL.createObjectURL(new Blob([image as unknown as BlobPart]));
          }
        }
        if (cancelled) return;
        setState({
          status: "ready",
          cover: {
            title: opened.book.title,
            creator: opened.book.creator,
            language: opened.book.language,
            chapters: opened.chapters.length,
            coverUrl: objectUrl,
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "refused",
          reason: error instanceof Error ? error.message : "This book could not be read.",
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [bytes]);

  return state;
}
