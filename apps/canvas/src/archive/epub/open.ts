import { readZipEntries, readZipEntry } from "../zip";
import {
  EpubError,
  type EpubPackage,
  packagePathOf,
  parsePackage,
  parseToc,
  tocSources,
} from "./package";

/**
 * Opening a book: the archive, read as far as its package and contents.
 *
 * The bytes are the only thing this reaches for; every chapter is left in the archive until a renderer asks
 * for it, because a reader browsing a table of contents should not decompress eight hundred kilobytes it will
 * not read. That is also why the archive is read once and its entries handed on rather than re-walked.
 */
export interface OpenedBook {
  readonly book: EpubPackage;
  /** The ways a book can be opened, in the order the reader is most likely to want them. */
  readonly mimetype: string | null;
  /** The chapter paths, in reading order, for a renderer that lists them without a nav. */
  readonly chapters: readonly string[];
  /** One chapter's markup, or null when the archive does not hold it. */
  readChapter: (path: string) => Promise<string | null>;
  /** One image inside the book, for a cover or an illustration a chapter references. */
  readResource: (path: string) => Promise<Uint8Array | null>;
}

const decoder = new TextDecoder();

/**
 * Read a book's package, spine and contents.
 *
 * Throws when the archive is not an EPUB at all, which is a refusal a reader can act on. Anything smaller —
 * a missing nav, an unreadable chapter — is reported by absence rather than thrown, because a book with a
 * broken contents page is still a book somebody wants to read.
 */
export async function openEpub(bytes: Uint8Array): Promise<OpenedBook> {
  let entries: ReturnType<typeof readZipEntries>;
  try {
    entries = readZipEntries(bytes);
  } catch {
    throw new EpubError("this file is not a zip archive, so it is not an EPUB");
  }

  const container = entries.find((entry) => entry.path === "META-INF/container.xml");
  if (container === undefined) {
    throw new EpubError("this file has no META-INF/container.xml, so it is not an EPUB");
  }

  const mimetype = await readZipEntry(bytes, "mimetype").then((found) =>
    found === null ? null : decoder.decode(found).trim(),
  );

  const packagePath = packagePathOf(decoder.decode(await container.read()));
  const packageBytes = await readZipEntry(bytes, packagePath);
  if (packageBytes === null) {
    throw new EpubError(
      `this book says its package is ${packagePath}, and the archive does not hold it`,
    );
  }

  const parsed = parsePackage(packagePath, decoder.decode(packageBytes));
  const sources = tocSources(parsed);

  const navXhtml = sources.nav === null ? null : await textOf(bytes, sources.nav);
  const ncxXml = sources.ncx === null ? null : await textOf(bytes, sources.ncx);

  const book: EpubPackage = {
    ...parsed,
    toc: parseToc(packagePath, navXhtml, ncxXml),
  };

  return {
    book,
    mimetype,
    chapters: book.spine.filter((item) => item.linear).map((item) => item.path),
    readChapter: (path) => textOf(bytes, path),
    readResource: (path) => readZipEntry(bytes, path),
  };
}

async function textOf(bytes: Uint8Array, path: string): Promise<string | null> {
  const found = await readZipEntry(bytes, path);
  return found === null ? null : decoder.decode(found);
}

/**
 * Whether a book is protected, which is a refusal rather than a bug.
 *
 * `META-INF/encryption.xml` is **not** a DRM signal on its own: a great many books obfuscate their embedded
 * fonts with it, and refusing those would turn away books that read perfectly well. What distinguishes a
 * protected book is `META-INF/rights.xml`, or an encryption entry covering a content document rather than a
 * font.
 */
export async function protectionOf(bytes: Uint8Array): Promise<string | null> {
  let entries: ReturnType<typeof readZipEntries>;
  try {
    entries = readZipEntries(bytes);
  } catch {
    return null;
  }

  if (entries.some((entry) => entry.path === "META-INF/rights.xml")) {
    return "this book is protected by DRM, which Suite cannot open";
  }

  const encryption = await readZipEntry(bytes, "META-INF/encryption.xml");
  if (encryption === null) return null;

  // The signal is *what* is encrypted, not that something is: font obfuscation names the fonts
  // (`.otf`, `.ttf`, `.woff`), while a protected book names its content documents. Reading the wrong one
  // would refuse books that open perfectly well.
  const xml = decoder.decode(encryption);
  const coversContent = [...xml.matchAll(/CipherReference[^>]*URI="([^"]+)"/gu)].some((match) =>
    /\.(x?html?|opf)$/iu.test(match[1] ?? ""),
  );
  return coversContent ? "this book's content is encrypted, which Suite cannot open" : null;
}
