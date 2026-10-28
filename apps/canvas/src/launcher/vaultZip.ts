import { fileKind, type VaultFile } from "@suite/import-obsidian";

/**
 * Owns a vault that arrives zipped.
 *
 * A folder picker is the pleasant path, and it is not one every device offers: a
 * tablet's Files app hands over a single file, so a vault somebody zipped is the only
 * shape they can choose. Reading a zip needs an inflate step, and every browser this
 * ships to has one — `DecompressionStream("deflate-raw")` is the raw DEFLATE that zip
 * stores — so this is a reader rather than a dependency.
 *
 * Only what a vault is gets read: notes and canvases as text, attachments by path and
 * size, the way `collectVaultFiles` reports a drop. Anything the archive could not be
 * read from is named, because an import that quietly loses a note is the failure the
 * report exists to prevent.
 */

/** Signatures, little-endian, as the format stores them. */
const END_OF_CENTRAL_DIRECTORY = 0x0605_4b50;
const CENTRAL_DIRECTORY_ENTRY = 0x0201_4b50;
const LOCAL_FILE_HEADER = 0x0403_4b50;

/** Where a central directory entry keeps its numbers. */
const METHOD = 10;
const COMPRESSED_SIZE = 20;
const UNCOMPRESSED_SIZE = 24;
const NAME_LENGTH = 28;
const EXTRA_LENGTH = 30;
const COMMENT_LENGTH = 32;
const LOCAL_OFFSET = 42;
const CENTRAL_HEADER_SIZE = 46;

/** Where a local file header keeps the lengths that push its data along. */
const LOCAL_NAME_LENGTH = 26;
const LOCAL_EXTRA_LENGTH = 28;
const LOCAL_HEADER_SIZE = 30;

/** Zip64 marks a size it could not fit in 32 bits. A vault is never that big. */
const ZIP64_MARKER = 0xffff_ffff;

const STORED = 0;
const DEFLATED = 8;

/** Archive bookkeeping, never vault content. */
function isNoise(path: string): boolean {
  if (path.length === 0 || path.endsWith("/")) return true;
  if (path.startsWith("__MACOSX/")) return true;
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === ".DS_Store" || name.length === 0;
}

/** The end-of-central-directory record, found from the end because its offset is not fixed. */
function findEnd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The record is 22 bytes plus a comment of up to 65,535; nothing longer can be.
  const earliest = Math.max(0, bytes.length - (22 + 0xffff));
  for (let at = bytes.length - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  return -1;
}

/** Every chunk of a stream, joined, because a zip entry's size is only known once it ends. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      size += value.length;
    }
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Raw DEFLATE, which is what a zip stores when it is not storing the bytes as they are. */
export function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  // `BufferSource` rather than `Uint8Array`: the platform types declare the transform's
  // writable side that way, and a stream typed to the chunk it is given is what pipes.
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      // A fresh view, so the chunk is backed by an `ArrayBuffer` and not a shared one.
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return collect(source.pipeThrough(new DecompressionStream("deflate-raw")));
}

/** A stored or deflated entry's bytes, as the file they describe. */
async function readEntry(view: DataView, bytes: Uint8Array, at: number): Promise<Uint8Array> {
  const method = view.getUint16(at + METHOD, true);
  const compressed = view.getUint32(at + COMPRESSED_SIZE, true);
  if (compressed === ZIP64_MARKER) throw new Error("this archive is too large to read");
  const localAt = view.getUint32(at + LOCAL_OFFSET, true);

  if (view.getUint32(localAt, true) !== LOCAL_FILE_HEADER) {
    throw new Error("this archive's entries do not line up");
  }
  const localName = view.getUint16(localAt + LOCAL_NAME_LENGTH, true);
  const localExtra = view.getUint16(localAt + LOCAL_EXTRA_LENGTH, true);
  const start = localAt + LOCAL_HEADER_SIZE + localName + localExtra;
  const data = bytes.subarray(start, start + compressed);

  if (method === STORED) return data;
  if (method !== DEFLATED) throw new Error("this archive uses a compression this reader lacks");

  return inflate(data);
}

export interface VaultZip {
  files: VaultFile[];
  /** The archive's own name, minus `.zip`, which is what the vault's board is called. */
  name: string;
}

/**
 * Read a zipped vault into the importer's file list.
 *
 * Throws when the archive cannot be read at all; a single unreadable entry is reported
 * in the returned files' absence rather than thrown, because one bad byte in a photograph
 * must not cost the reader their notes.
 */
export async function readVaultZip(bytes: Uint8Array, archiveName: string): Promise<VaultZip> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(bytes);
  if (end === -1) throw new Error("this file is not a zip archive");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);

  const files: VaultFile[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error("this archive's index does not line up");
    }
    const nameLength = view.getUint16(at + NAME_LENGTH, true);
    const extraLength = view.getUint16(at + EXTRA_LENGTH, true);
    const commentLength = view.getUint16(at + COMMENT_LENGTH, true);
    const path = new TextDecoder().decode(
      bytes.subarray(at + CENTRAL_HEADER_SIZE, at + CENTRAL_HEADER_SIZE + nameLength),
    );
    const next = at + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    if (isNoise(path)) {
      at = next;
      continue;
    }

    const kind = fileKind({ path });
    if (kind === "note" || kind === "canvas") {
      try {
        const content = await readEntry(view, bytes, at);
        files.push({ path, text: new TextDecoder().decode(content) });
      } catch {
        // Named by its absence: the importer reports what it did not get.
      }
    } else {
      // An attachment's bytes are never parsed, so its size is all that is read.
      files.push({
        path,
        byteLength: view.getUint32(at + UNCOMPRESSED_SIZE, true),
      });
    }
    at = next;
  }

  const name = archiveName.replace(/\.zip$/iu, "");
  return { files, name };
}
