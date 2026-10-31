import { create } from "zustand";
import { openEpub } from "../archive/epub/open";
import {
  ATTACHMENT_ID_PATTERN,
  attachmentUrl,
  readLocalAttachment,
} from "../editor/attachmentNode";
import { isStandalone } from "../session/mode";

/**
 * What a book says about itself: its title, its author, its chapter count, and its cover.
 *
 * A canvas face draws synchronously and cheaply — a board of forty cards is forty faces before anybody clicks — and
 * everything here lives inside a zip. So it is read out of band, once per book per session, and published to a store
 * the faces subscribe to: the tile paints first, the picture arrives, and the layout does not move.
 *
 * Three states, not two, and that distinction is the whole point. `pending` means "not read yet — try again",
 * `none` means "read, and the book has no cover", and `ready` carries what the book said. A first paint that races an
 * upload is `pending` and keeps retrying; only an archive that was actually opened can become `none`. Marking a book
 * done because its bytes were not here yet is how a cover used to disappear until a refresh.
 */
export interface BookMeta {
  readonly title: string;
  readonly creator: string | null;
  readonly chapters: number;
}

export type BookEntry =
  | { readonly status: "pending" }
  | { readonly status: "none"; readonly reason: string }
  | { readonly status: "ready"; readonly meta: BookMeta; readonly coverUrl: string | null };

interface BookMetaState {
  readonly entries: Readonly<Record<string, BookEntry>>;
  publish: (attachmentId: string, entry: BookEntry) => void;
}

export const useBookMeta = create<BookMetaState>()((set, get) => ({
  entries: {},
  publish: (attachmentId, entry) => {
    const previous = get().entries[attachmentId];
    // A replaced cover is a leaked object URL unless the old one is revoked: a re-extract must not accumulate them.
    if (
      previous?.status === "ready" &&
      previous.coverUrl !== null &&
      previous.coverUrl !== entryCover(entry)
    ) {
      revoke(previous.coverUrl);
    }
    set({ entries: { ...get().entries, [attachmentId]: entry } });
  },
}));

function entryCover(entry: BookEntry): string | null {
  return entry.status === "ready" ? entry.coverUrl : null;
}

function revoke(url: string): void {
  if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
}

/** What this session knows about a book: synchronously, for a face that must not wait. */
export function bookEntryOf(attachmentId: string): BookEntry {
  return useBookMeta.getState().entries[attachmentId] ?? { status: "pending" };
}

/**
 * How long to wait before trying a book again whose bytes were not here.
 *
 * An upload is the case this exists for: the card is on the board before its bytes reach the relay, so the first
 * reads miss. Three attempts over twelve seconds covers a normal upload and then stops, because a book that is
 * genuinely absent should not be a spinner forever.
 */
const RETRY_DELAYS = [1000, 3000, 8000] as const;

const inFlight = new Set<string>();
const attempts = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Read one book, unless it is already read, being read, or waiting to be retried. */
export function loadBook(attachmentId: string): void {
  const entry = useBookMeta.getState().entries[attachmentId];
  if (entry !== undefined) return;
  if (inFlight.has(attachmentId) || timers.has(attachmentId)) return;
  if (!ATTACHMENT_ID_PATTERN.test(attachmentId)) {
    useBookMeta.getState().publish(attachmentId, {
      status: "none",
      reason: "This block does not name a stored book.",
    });
    return;
  }
  inFlight.add(attachmentId);

  const publish = (next: BookEntry) => useBookMeta.getState().publish(attachmentId, next);

  void (async () => {
    try {
      const bytes = await bytesFor(attachmentId);
      if (bytes === null) {
        // Not read, so not decided: leave it pending and come back once the bytes can plausibly have landed.
        scheduleRetry(attachmentId);
        return;
      }

      const opened = await openEpub(bytes);
      const meta: BookMeta = {
        title: opened.book.title,
        creator: opened.book.creator,
        chapters: opened.chapters.length,
      };

      let coverUrl: string | null = null;
      if (opened.book.coverPath !== null) {
        const image = await opened.readResource(opened.book.coverPath);
        if (image !== null && typeof URL.createObjectURL === "function") {
          coverUrl = URL.createObjectURL(new Blob([image as unknown as BlobPart]));
        }
      }
      publish({ status: "ready", meta, coverUrl });
    } catch (error) {
      // A file that is here and is not a book is a refusal, not a pending read: retrying it would be a spinner on a
      // file that will never open.
      publish({
        status: "none",
        reason: error instanceof Error ? error.message : "This book could not be read.",
      });
    } finally {
      inFlight.delete(attachmentId);
    }
  })();
}

function scheduleRetry(attachmentId: string): void {
  const tried = attempts.get(attachmentId) ?? 0;
  const delay = RETRY_DELAYS[tried];
  if (delay === undefined) return;
  attempts.set(attachmentId, tried + 1);
  const timer = setTimeout(() => {
    timers.delete(attachmentId);
    loadBook(attachmentId);
  }, delay);
  timers.set(attachmentId, timer);
}

/** Ask again now, which is what a surface does after it knows the bytes landed. */
export function retryBook(attachmentId: string): void {
  const timer = timers.get(attachmentId);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(attachmentId);
  }
  const entry = useBookMeta.getState().entries[attachmentId];
  if (entry?.status === "ready") return;
  loadBook(attachmentId);
}

async function bytesFor(attachmentId: string): Promise<Uint8Array | null> {
  const local = await readLocalAttachment(attachmentId).catch(() => null);
  if (local) return local.bytes;
  if (isStandalone()) return null;
  const response = await fetch(attachmentUrl(attachmentId)).catch(() => null);
  return response?.ok === true ? new Uint8Array(await response.arrayBuffer()) : null;
}

/** Forget every book this session read. Tests only: one case's book must not be the next one's. */
export function forgetBooks(): void {
  const entries = useBookMeta.getState().entries;
  for (const entry of Object.values(entries)) {
    if (entry.status === "ready" && entry.coverUrl !== null) revoke(entry.coverUrl);
  }
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  attempts.clear();
  inFlight.clear();
  useBookMeta.setState({ entries: {} });
}
