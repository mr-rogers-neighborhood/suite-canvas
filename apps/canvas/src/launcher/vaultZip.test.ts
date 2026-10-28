import { describe, expect, it } from "vitest";
import { readVaultZip } from "./vaultZip";

/**
 * A zipped vault, read without a dependency.
 *
 * The fixtures are written here rather than committed, because the archive format is the
 * thing under test: a stored entry and a deflated one exercise both paths, and the two
 * pieces of bookkeeping a vault archive always carries (`__MACOSX/`, a directory) prove
 * they are skipped rather than imported as notes called "".
 */

const encoder = new TextEncoder();

interface Entry {
  path: string;
  text?: string;
  /** Absent means "store it", which is what an archive of a vault uses for images. */
  deflate?: boolean;
}

function u16(view: DataView, at: number, value: number): void {
  view.setUint16(at, value, true);
}

function u32(view: DataView, at: number, value: number): void {
  view.setUint32(at, value, true);
}

async function deflate(text: string): Promise<Uint8Array> {
  // The same shape `inflate` unwraps: a stream, never a Blob, because this runs under
  // jsdom as well as in a browser.
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
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

/** A zip of `entries`, assembled the way a writer does: local headers, then the index. */
async function zip(entries: readonly Entry[]): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const central: { path: Uint8Array; method: number; size: number; raw: number; offset: number }[] =
    [];
  let offset = 0;

  for (const entry of entries) {
    const path = encoder.encode(entry.path);
    const content = entry.text === undefined ? new Uint8Array() : encoder.encode(entry.text);
    const data = entry.deflate === true ? await deflate(entry.text ?? "") : content;
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

  const indexSize = central.reduce((total, entry) => total + 46 + entry.path.length, 0);
  const index = new Uint8Array(indexSize);
  const indexView = new DataView(index.buffer);
  let at = 0;
  for (const entry of central) {
    u32(indexView, at, 0x0201_4b50);
    u16(indexView, at + 10, entry.method);
    u32(indexView, at + 20, entry.size);
    u32(indexView, at + 24, entry.raw);
    u16(indexView, at + 28, entry.path.length);
    u32(indexView, at + 42, entry.offset);
    index.set(entry.path, at + 46);
    at += 46 + entry.path.length;
  }

  const out = new Uint8Array(offset + index.length + 22);
  const outView = new DataView(out.buffer);
  let cursor = 0;
  for (const local of locals) {
    out.set(local, cursor);
    cursor += local.length;
  }
  out.set(index, cursor);
  cursor += index.length;
  u32(outView, cursor, 0x0605_4b50);
  u16(outView, cursor + 8, central.length);
  u16(outView, cursor + 10, central.length);
  u32(outView, cursor + 12, index.length);
  u32(outView, cursor + 16, offset);
  return out;
}

describe("reading a zipped vault", () => {
  it("reads a note, a canvas and an attachment, and names the board after the archive", async () => {
    const bytes = await zip([
      { path: "Vault/Alpha.md", text: "# Alpha", deflate: true },
      { path: "Vault/Board.canvas", text: '{"nodes":[]}' },
      { path: "Vault/photo.png", text: "not really a picture" },
    ]);

    const vault = await readVaultZip(bytes, "Vault.zip");

    expect(vault.name).toBe("Vault");
    expect(vault.files.map((file) => file.path)).toEqual([
      "Vault/Alpha.md",
      "Vault/Board.canvas",
      "Vault/photo.png",
    ]);
    expect(vault.files[0]?.text).toBe("# Alpha");
    expect(vault.files[1]?.text).toBe('{"nodes":[]}');
    // An attachment is carried by path and size: its bytes are never parsed.
    expect(vault.files[2]?.text).toBeUndefined();
    expect(vault.files[2]?.byteLength).toBe(20);
  });

  it("skips the bookkeeping an archive carries rather than importing it", async () => {
    const bytes = await zip([
      { path: "Vault/", text: "" },
      { path: "__MACOSX/Vault/._Alpha.md", text: "junk" },
      { path: "Vault/.DS_Store", text: "junk" },
      { path: "Vault/Alpha.md", text: "real" },
    ]);

    const vault = await readVaultZip(bytes, "Vault.zip");

    expect(vault.files.map((file) => file.path)).toEqual(["Vault/Alpha.md"]);
  });

  it("refuses a file that is not an archive, rather than importing nothing quietly", async () => {
    await expect(readVaultZip(encoder.encode("this is a note"), "Alpha.md")).rejects.toThrow(
      /not a zip archive/u,
    );
  });
});
