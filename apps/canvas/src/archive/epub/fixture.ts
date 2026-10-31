/**
 * A small book, assembled in tests.
 *
 * Committed books are megabytes of somebody else's copyright; a generated one is a few hundred bytes of
 * markup that exercises the three facts a package holds — the container, the package and the contents — plus
 * the cases that break real readers: a nested spine directory, a nav that points at a fragment, an NCX with
 * no nav beside it, and a font-obfuscated archive that must not be mistaken for DRM.
 *
 * Test-only, but not a `.test.ts`: two suites open it, and a helper that lives in one of them would be
 * imported across a test boundary.
 */
import { readZipEntries } from "../zip";

const encoder = new TextEncoder();

export interface FixtureEntry {
  path: string;
  text?: string;
  /** Base64, for the bytes of a cover image. */
  base64?: string;
  deflate?: boolean;
}

function u16(view: DataView, at: number, value: number): void {
  view.setUint16(at, value, true);
}

function u32(view: DataView, at: number, value: number): void {
  view.setUint32(at, value, true);
}

async function deflate(text: string): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(new Uint8Array(encoder.encode(text)));
      controller.close();
    },
  });
  const reader = source.pipeThrough(new CompressionStream("deflate-raw")).getReader();
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

function bytesOf(entry: FixtureEntry): Uint8Array {
  if (entry.base64 !== undefined) {
    const binary = atob(entry.base64);
    const out = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1) out[at] = binary.charCodeAt(at);
    return out;
  }
  return encoder.encode(entry.text ?? "");
}

/** A zip of `entries`, assembled the way a writer does: local headers, then the index. */
export async function zipOf(entries: readonly FixtureEntry[]): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const central: { path: Uint8Array; method: number; size: number; raw: number; offset: number }[] =
    [];
  let offset = 0;

  for (const entry of entries) {
    const path = encoder.encode(entry.path);
    const content = bytesOf(entry);
    const data =
      entry.deflate === true ? await deflate(new TextDecoder().decode(content)) : content;
    const local = new Uint8Array(30 + path.length + data.length);
    const localView = new DataView(local.buffer);
    u32(localView, 0, 0x0403_4b50);
    u16(localView, 8, entry.deflate === true ? 8 : 0);
    u32(localView, 18, data.length);
    u32(localView, 22, content.length);
    u16(localView, 26, path.length);
    u16(localView, 28, 0);
    local.set(path, 30);
    local.set(data, 30 + path.length);
    locals.push(local);
    central.push({
      path,
      method: entry.deflate === true ? 8 : 0,
      size: data.length,
      raw: content.length,
      offset,
    });
    offset += local.length;
  }

  const centralSize = central.reduce((total, entry) => total + 46 + entry.path.length, 0);
  const out = new Uint8Array(offset + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const local of locals) {
    out.set(local, at);
    at += local.length;
  }
  const centralStart = at;
  for (const entry of central) {
    u32(view, at, 0x0201_4b50);
    u16(view, at + 10, entry.method);
    u32(view, at + 20, entry.size);
    u32(view, at + 24, entry.raw);
    u16(view, at + 28, entry.path.length);
    u32(view, at + 42, entry.offset);
    out.set(entry.path, at + 46);
    at += 46 + entry.path.length;
  }
  u32(view, at, 0x0605_4b50);
  u16(view, at + 8, central.length);
  u16(view, at + 10, central.length);
  u32(view, at + 12, at - centralStart);
  u32(view, at + 16, centralStart);
  return out;
}

export const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

export const CONTENT_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>A Small Book</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">urn:uuid:1234</dc:identifier>
    <dc:rights>Public domain</dc:rights>
    <meta property="rendition:layout">reflowable</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="cover-page" linear="no"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

export const NAV_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="text/chapter1.xhtml">One</a></li>
        <li><a href="text/chapter2.xhtml#part-two">Two, and a place inside it</a>
          <ol><li><a href="text/chapter2.xhtml#deeper">Deeper</a></li></ol>
        </li>
      </ol>
    </nav>
  </body>
</html>`;

export const CHAPTER_ONE = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>One</title><link rel="stylesheet" href="../styles/book.css"/></head>
  <body>
    <h1>One</h1>
    <p>The first sentence of the book.</p>
    <p>A second paragraph, with <em>emphasis</em> and a <a href="chapter2.xhtml#deeper">link</a>.</p>
  </body>
</html>`;

export const CHAPTER_TWO = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Two</title></head>
  <body>
    <h1 id="part-two">Two</h1>
    <p>The same sentence appears twice. The same sentence appears twice.</p>
    <p id="deeper">A place a link can point at.</p>
  </body>
</html>`;

/** A one-pixel PNG, so a cover can be asserted without a real image in the repository. */
export const PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** The default fixture: three files, a spine that names a missing cover page, a nav that nests. */
export function bookEntries(extra: readonly FixtureEntry[] = []): FixtureEntry[] {
  return [
    { path: "mimetype", text: "application/epub+zip" },
    { path: "META-INF/" },
    { path: "META-INF/container.xml", text: CONTAINER_XML, deflate: true },
    { path: "OEBPS/" },
    { path: "OEBPS/content.opf", text: CONTENT_OPF, deflate: true },
    { path: "OEBPS/nav.xhtml", text: NAV_XHTML },
    { path: "OEBPS/text/chapter1.xhtml", text: CHAPTER_ONE, deflate: true },
    { path: "OEBPS/text/chapter2.xhtml", text: CHAPTER_TWO, deflate: true },
    { path: "OEBPS/images/cover.png", base64: PIXEL_PNG_BASE64 },
    { path: "OEBPS/styles/book.css", text: "h1 { font-family: Arial; }" },
    ...extra,
  ];
}

/** A book whose package spells the same paths without the directory prefix. */
export function flatPathBook(): FixtureEntry[] {
  return [
    { path: "mimetype", text: "application/epub+zip" },
    {
      path: "META-INF/container.xml",
      text: CONTAINER_XML.replace("OEBPS/content.opf", "content.opf"),
    },
    {
      path: "content.opf",
      text: CONTENT_OPF.replace(/href="(text|images|styles)\//gu, 'href="$1/'),
    },
    { path: "nav.xhtml", text: NAV_XHTML },
    { path: "text/chapter1.xhtml", text: CHAPTER_ONE },
  ];
}

/** An NCX-only book, the EPUB 2 shape, with no nav document in the manifest. */
export function ncxOnlyBook(): FixtureEntry[] {
  return [
    { path: "mimetype", text: "application/epub+zip" },
    { path: "META-INF/container.xml", text: CONTAINER_XML },
    {
      path: "OEBPS/content.opf",
      text: CONTENT_OPF.replace(
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
      ),
    },
    {
      path: "OEBPS/toc.ncx",
      text: `<?xml version="1.0"?>
<navMap xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navPoint id="p1"><navLabel><text>Chapter one</text></navLabel><content src="text/chapter1.xhtml"/></navPoint>
  <navPoint id="p2"><navLabel><text>Chapter two</text></navLabel><content src="text/chapter2.xhtml"/>
    <navPoint id="p3"><navLabel><text>Deep</text></navLabel><content src="text/chapter2.xhtml#deeper"/></navPoint>
  </navPoint>
</navMap>`,
    },
    { path: "OEBPS/text/chapter1.xhtml", text: CHAPTER_ONE },
    { path: "OEBPS/text/chapter2.xhtml", text: CHAPTER_TWO },
  ];
}

/** A book where the encryption covers a content document rather than a font. */
export function protectedBook(): FixtureEntry[] {
  return bookEntries([
    {
      path: "META-INF/encryption.xml",
      text: `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <CipherData><CipherReference URI="OEBPS/text/chapter1.xhtml"/></CipherData>
  </EncryptedData>
</encryption>`,
    },
  ]);
}

/** A book that obfuscates its fonts, which is ordinary and must not be read as protection. */
export function fontObfuscatedBook(): FixtureEntry[] {
  return bookEntries([
    {
      path: "META-INF/encryption.xml",
      text: `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <CipherData><CipherReference URI="OEBPS/fonts/book.otf"/></CipherData>
  </EncryptedData>
</encryption>`,
    },
  ]);
}

/** For a test that has to name what an archive holds when a parse fails. */
export function pathsOf(bytes: Uint8Array): string[] {
  return readZipEntries(bytes).map((entry) => entry.path);
}
