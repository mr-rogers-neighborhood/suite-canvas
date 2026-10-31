import { create } from "zustand";
import { openEpub } from "../archive/epub/open";
import {
  ATTACHMENT_ID_PATTERN,
  attachmentUrl,
  readLocalAttachment,
} from "../editor/attachmentNode";
import { isStandalone } from "../session/mode";

/**
 * A book's cover, extracted once and kept for the session.
 *
 * The canvas face draws a card synchronously and cheaply: a board of forty cards is forty faces before anybody
 * clicks. A cover lives inside a zip, so drawing one means reading the package and decompressing an image, which is
 * exactly the work that face must not do per paint.
 *
 * So the cover is extracted out of band, deduped by attachment, and published here. A face reads what is ready and
 * draws the book's name until then, which is why a board settled on a card shows a cover and a board that has just
 * opened does not: the picture arrives, the layout does not move.
 */
interface BookCoverState {
  /** Attachment id → an object URL for the declared cover image. */
  readonly covers: Readonly<Record<string, string>>;
  /** Ids this session has already tried, so a book with no cover is not read again on every paint. */
  readonly tried: ReadonlySet<string>;
  publish: (attachmentId: string, url: string | null) => void;
}

export const useBookCoverCache = create<BookCoverState>()((set, get) => ({
  covers: {},
  tried: new Set<string>(),

  publish: (attachmentId, url) => {
    const tried = new Set(get().tried);
    tried.add(attachmentId);
    set({
      tried,
      ...(url === null ? {} : { covers: { ...get().covers, [attachmentId]: url } }),
    });
  },
}));

/** What this session has for a book, synchronously: a cover, nothing yet, or "there is none". */
export function coverOf(attachmentId: string): string | null {
  return useBookCoverCache.getState().covers[attachmentId] ?? null;
}

const inFlight = new Set<string>();

/** What a book says about itself, read once per session from whichever copy of the bytes this browser has. */
const details = new Map<string, BookDetails>();

export interface BookDetails {
  readonly title: string;
  readonly creator: string | null;
  readonly chapters: number;
}

/**
 * A book's title, author and chapter count.
 *
 * The same bytes and the same order as the cover, from the same module, because the relay is reached in one place:
 * a second reader of the same archive in a card component would be a second gate to keep honest.
 */
export async function bookDetails(attachmentId: string): Promise<BookDetails | null> {
  const known = details.get(attachmentId);
  if (known !== undefined) return known;
  const bytes = await bytesFor(attachmentId);
  if (bytes === null) return null;
  try {
    const opened = await openEpub(bytes);
    const found = {
      title: opened.book.title,
      creator: opened.book.creator,
      chapters: opened.chapters.length,
    };
    details.set(attachmentId, found);
    return found;
  } catch {
    return null;
  }
}

async function bytesFor(attachmentId: string): Promise<Uint8Array | null> {
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) return null;
  const local = await readLocalAttachment(attachmentId).catch(() => null);
  if (local) return local.bytes;
  if (isStandalone()) return null;
  const response = await fetch(attachmentUrl(attachmentId)).catch(() => null);
  return response?.ok === true ? new Uint8Array(await response.arrayBuffer()) : null;
}

/**
 * Extract one book's cover.
 *
 * The bytes come from wherever every attachment comes from: this browser first, the relay second. A book that has
 * not finished uploading has no cover yet, and that is stated by the empty tile rather than by a broken picture.
 */
export async function extractCover(attachmentId: string): Promise<void> {
  const state = useBookCoverCache.getState();
  if (state.tried.has(attachmentId) || inFlight.has(attachmentId)) return;
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) return;
  inFlight.add(attachmentId);

  const publish = (url: string | null) => useBookCoverCache.getState().publish(attachmentId, url);

  try {
    const bytes = await bytesFor(attachmentId);
    if (bytes === null) {
      // Not failed, just not here yet: leaving it untried means the next paint can try again once the upload lands.
      publish(null);
      return;
    }

    const opened = await openEpub(bytes);
    if (opened.book.coverPath === null) {
      publish(null);
      return;
    }
    const image = await opened.readResource(opened.book.coverPath);
    if (image === null || typeof URL.createObjectURL !== "function") {
      publish(null);
      return;
    }
    publish(URL.createObjectURL(new Blob([image as unknown as BlobPart])));
  } catch {
    publish(null);
  } finally {
    inFlight.delete(attachmentId);
  }
}

/** Forget this session's covers. Only for tests, where one case's book must not be the next one's. */
export function forgetBookCovers(): void {
  const covers = useBookCoverCache.getState().covers;
  for (const url of Object.values(covers)) {
    if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }
  useBookCoverCache.setState({ covers: {}, tried: new Set() });
  details.clear();
  inFlight.clear();
}
