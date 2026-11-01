import { describe, expect, it } from "vitest";
import { imageMime, imagePaths, resolveImages } from "./chapterAssets";

/**
 * A book's pictures.
 *
 * The sanitiser leaves an `src` as the archive path, which is right — nothing is fetched at render time — but it means
 * a chapter that is drawn without resolving those paths asks the app's own origin for `OEBPS/images/cover.png` and gets
 * a 404. These are the two halves of the fix.
 */
describe("the pictures in a chapter", () => {
  it("should find each archive path once, whatever the image is", () => {
    const html =
      '<p>Words</p><img src="OEBPS/images/a.png" alt="a">' +
      '<img src="OEBPS/images/b.jpg" alt="b"><img src="OEBPS/images/a.png" alt="again">';

    expect(imagePaths(html)).toEqual(["OEBPS/images/a.png", "OEBPS/images/b.jpg"]);
  });

  it("should leave a data URL alone, because it is already in the document", () => {
    expect(imagePaths('<img src="data:image/png;base64,AAAA" alt="">')).toEqual([]);
  });

  it("should point a resolved picture at its URL, and an unresolved one at nothing", () => {
    const html = '<img src="OEBPS/a.png" alt="a"><img src="OEBPS/missing.png" alt="b">';
    const resolved = resolveImages(html, new Map([["OEBPS/a.png", "blob:one"]]));

    expect(resolved).toContain('src="blob:one"');
    // Not the archive path: that would be a request against the app's origin, which is the 404 this fixes.
    expect(resolved).not.toContain('src="OEBPS/missing.png"');
    expect(resolved).toContain('data-missing-image="OEBPS/missing.png"');
    // The words the picture stood for are still there.
    expect(resolved).toContain('alt="a"');
    expect(resolved).toContain('alt="b"');
  });

  it("should return the markup untouched when nothing was loaded", () => {
    const html = '<p>Words</p><img src="OEBPS/a.png" alt="a">';
    expect(resolveImages(html, new Map())).toBe(html);
  });

  it("should read a media type from the extension, and say nothing useful when there is none", () => {
    expect(imageMime("OEBPS/images/cover.png")).toBe("image/png");
    expect(imageMime("OEBPS/images/cover.JPEG")).toBe("image/jpeg");
    expect(imageMime("OEBPS/images/picture.svg")).toBe("image/svg+xml");
    expect(imageMime("OEBPS/images/mystery")).toBe("application/octet-stream");
  });
});
