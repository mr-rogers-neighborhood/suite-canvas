import {
  attachmentId,
  markAttachmentUploaded,
  storeLocalAttachment,
} from "../editor/attachmentNode";
import { relayUploader } from "../editor/pasteImages";

/**
 * A cover chosen by link.
 *
 * The picker's other options are the images already in the workspace, because an
 * attachment only exists when a card body references it. A link is the one case where the
 * bytes do not exist anywhere yet, so they are imported the same way a pasted image is:
 * kept locally under a new id (so the cover shows at once, even offline) and offered to
 * the relay so collaborators see it too. The board stores the id, exactly as it does for
 * an image that came from a card — one cover representation, not two.
 */

/** What a URL cover needs from the world, injectable so a test needs no network. */
export interface CoverImportDeps {
  fetch?: (url: string) => Promise<Response>;
  newId?: () => string;
  storeLocal?: (id: string, bytes: Uint8Array, mime: string) => Promise<void>;
  /** Uploads to the relay, or null where this page has none. */
  upload?: ((entry: { id: string; bytes: Uint8Array; mime: string }) => Promise<void>) | null;
  markUploaded?: (id: string) => Promise<void>;
}

/** Why a link could not become a cover, in the one sentence the panel shows. */
export class CoverImportError extends Error {}

const ACCEPTED = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] as const;

function imageMime(response: Response): string | null {
  const declared = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (declared && (ACCEPTED as readonly string[]).includes(declared)) return declared;
  return null;
}

/**
 * Fetches `url` and returns the attachment id a board can point its cover at.
 *
 * Throws `CoverImportError` with a readable sentence for every way this fails, because
 * the panel has one line to say what happened and the caller must leave the current
 * cover alone. A link that is not an image is refused before any bytes are kept: a cover
 * that silently became nothing would look like the button did not work.
 */
export async function importCoverFromUrl(url: string, deps: CoverImportDeps = {}): Promise<string> {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CoverImportError("That is not a link.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CoverImportError("A cover link has to start with https://.");
  }

  const request = deps.fetch ?? ((target: string) => fetch(target));
  let response: Response;
  try {
    response = await request(trimmed);
  } catch {
    // A cross-origin image with no CORS header cannot be read, and the browser says so
    // only as a network failure. Naming both reasons is what stops the reader retrying.
    throw new CoverImportError("That link could not be read. Try one that allows other sites.");
  }
  if (!response.ok) {
    throw new CoverImportError(`That link answered ${response.status}.`);
  }

  const mime = imageMime(response);
  if (!mime) throw new CoverImportError("That link is not an image.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new CoverImportError("That link was empty.");

  const id = (deps.newId ?? attachmentId)();
  await (deps.storeLocal ?? storeLocalAttachment)(id, bytes, mime);

  const upload = deps.upload === undefined ? relayUploader() : deps.upload;
  if (upload) {
    try {
      await upload({ id, bytes, mime });
      await (deps.markUploaded ?? markAttachmentUploaded)(id);
    } catch {
      // The local copy is the cover either way: an upload that failed is the state every
      // pasted image starts in, and the sync panel is where that is reported.
    }
  }
  return id;
}
