import { describe, expect, it, vi } from "vitest";
import { CoverImportError, importCoverFromUrl } from "./coverFromUrl";

const IMAGE = new Uint8Array([1, 2, 3, 4]);

/** A response stub; `Response` itself would need a browser-ish body for bytes. */
function response(init: {
  ok?: boolean;
  status?: number;
  type?: string | null;
  bytes?: Uint8Array;
}): Response {
  const { ok = true, status = 200, type = "image/png", bytes = IMAGE } = init;
  return {
    ok,
    status,
    headers: new Headers(type ? { "content-type": type } : {}),
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

const deps = (fetchImpl: () => Promise<Response>) => ({
  fetch: fetchImpl,
  newId: () => "0123456789abcdef0123456789abcdef",
  storeLocal: vi.fn(async () => {}),
  upload: null as
    | null
    | ((entry: { id: string; bytes: Uint8Array; mime: string }) => Promise<void>),
  markUploaded: vi.fn(async () => {}),
});

describe("a cover from a link", () => {
  it("keeps the bytes under a new id and hands back that id", async () => {
    const options = deps(async () => response({}));

    const id = await importCoverFromUrl("https://example.com/a.png", options);

    expect(id).toBe("0123456789abcdef0123456789abcdef");
    expect(options.storeLocal).toHaveBeenCalledWith(id, IMAGE, "image/png");
  });

  it("offers the bytes to the relay so collaborators see the same cover", async () => {
    const upload = vi.fn(async () => {});
    const options = { ...deps(async () => response({ type: "image/jpeg" })), upload };

    await importCoverFromUrl("https://example.com/a.jpg", options);

    expect(upload).toHaveBeenCalledWith({
      id: "0123456789abcdef0123456789abcdef",
      bytes: IMAGE,
      mime: "image/jpeg",
    });
    expect(options.markUploaded).toHaveBeenCalled();
  });

  it("keeps the cover when the relay refuses, because the local copy is the cover", async () => {
    const options = {
      ...deps(async () => response({})),
      upload: async () => {
        throw new Error("402");
      },
    };

    // No throw: an upload failure is the state every pasted image starts in.
    await expect(importCoverFromUrl("https://example.com/a.png", options)).resolves.toBe(
      "0123456789abcdef0123456789abcdef",
    );
    expect(options.markUploaded).not.toHaveBeenCalled();
  });

  it("refuses a link that is not an image, before keeping any bytes", async () => {
    const options = deps(async () => response({ type: "text/html" }));

    await expect(importCoverFromUrl("https://example.com/page", options)).rejects.toThrow(
      /not an image/,
    );
    expect(options.storeLocal).not.toHaveBeenCalled();
  });

  it("says what went wrong in a sentence the panel can show", async () => {
    const cases: Array<[string, () => Promise<Response>, RegExp]> = [
      ["not a link", async () => response({}), /not a link/i],
      ["ftp://example.com/a.png", async () => response({}), /https/i],
      [
        "https://example.com/missing.png",
        async () => response({ ok: false, status: 404 }),
        /answered 404/,
      ],
      [
        "https://example.com/blocked.png",
        async () => {
          throw new TypeError("Failed to fetch");
        },
        /allows other sites/,
      ],
    ];

    for (const [url, fetchImpl, expected] of cases) {
      const options = deps(fetchImpl);
      await expect(importCoverFromUrl(url, options)).rejects.toThrow(expected);
      // The failure is a `CoverImportError`, which is what lets the panel tell "we
      // refused" from "the app broke".
      await expect(importCoverFromUrl(url, options)).rejects.toBeInstanceOf(CoverImportError);
    }
  });

  it("trims a link pasted with a space around it", async () => {
    const options = deps(async () => response({}));
    const seen: string[] = [];

    await importCoverFromUrl("  https://example.com/a.png  ", {
      ...options,
      fetch: async (url: string) => {
        seen.push(url);
        return response({});
      },
    });

    expect(seen).toEqual(["https://example.com/a.png"]);
  });
});
