/**
 * Reading a zip archive, without a dependency.
 *
 * Every browser this ships to can inflate: `DecompressionStream("deflate-raw")` is the raw DEFLATE a zip
 * stores, so a reader is a few hundred lines of bookkeeping rather than a package. Two features need one —
 * a zipped vault and an EPUB, which is a zip with a package inside it — so the walk lives here and each
 * caller decides what to do with the entries.
 *
 * The index is read first (from the end of the file, where its offset is not fixed), because a local header
 * cannot be walked reliably on its own: a writer is free to put a data descriptor after the bytes instead of
 * sizes in front of them, and only the central directory is always trustworthy.
 */

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

/** Zip64 marks a size it could not fit in 32 bits. Neither a vault nor a book is that big. */
const ZIP64_MARKER = 0xffff_ffff;

const STORED = 0;
const DEFLATED = 8;

/** One entry: its path and size now, its bytes when they are asked for. */
export interface ZipEntry {
  /** The path as the archive stores it, with forward slashes and no leading slash. */
  readonly path: string;
  /** Size before decompression, which is all a caller needs to list rather than open. */
  readonly size: number;
  /** The entry's bytes. Throws when the entry cannot be read, so one bad entry cannot lose the rest. */
  read: () => Promise<Uint8Array>;
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

/** Every chunk of a stream, joined, because an entry's size is only known once it ends. */
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
  // `BufferSource` rather than `Uint8Array`: the platform types declare the transform's writable side
  // that way, and a stream typed to the chunk it is given is what pipes.
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

/**
 * Every entry in an archive, in the order its index lists them.
 *
 * Directory entries are dropped, because a directory is a path prefix and not a file: a caller that walked
 * one would report a note called "".
 *
 * Throws when the archive cannot be read at all. A single entry that fails to decompress throws only when
 * its `read` is called, so a caller can report one bad file without losing the other hundred.
 */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEnd(bytes);
  if (end === -1) throw new Error("this file is not a zip archive");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);

  const entries: ZipEntry[] = [];
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
    const size = view.getUint32(at + UNCOMPRESSED_SIZE, true);
    // The closure captures where this entry's record sits, not the loop's cursor.
    const record = at;
    at += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    if (path.endsWith("/")) continue;

    entries.push({
      path,
      size,
      read: () => readEntry(view, bytes, record),
    });
  }
  return entries;
}

/** One entry's bytes, by exact path; `null` when the archive does not hold it. */
export async function readZipEntry(bytes: Uint8Array, path: string): Promise<Uint8Array | null> {
  const entry = readZipEntries(bytes).find((candidate) => candidate.path === path);
  return entry === undefined ? null : entry.read();
}

/** An archive's paths, for an error that has to name what an archive does hold. */
export function zipEntryPaths(bytes: Uint8Array): string[] {
  return readZipEntries(bytes).map((entry) => entry.path);
}
