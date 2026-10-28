import { describe, expect, it } from "vitest";
import { entryBundleOf, isStaleBuild, loadedEntry } from "./staleBuild";

/**
 * The name both sides compare is the entry chunk's, so the parse has to find the
 * module script and nothing else — a lazy chunk name in the same HTML would make a
 * fresh tab look stale once a deploy changed any other chunk.
 */
describe("stale build", () => {
  it("reads the entry chunk out of a built page", () => {
    const html = `<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/main-HY_6-MKg.js"></script>
      <link rel="modulepreload" href="/assets/react-CSQqQeCV.js">
    </head></html>`;
    expect(entryBundleOf(html)).toBe("/assets/main-HY_6-MKg.js");
  });

  it("finds no name in a dev page", () => {
    const html = `<script type="module" src="/src/main.tsx"></script>`;
    expect(entryBundleOf(html)).toBeNull();
  });

  it("reads the entry this document loaded", () => {
    document.head.innerHTML = '<script type="module" src="/assets/main-gDMPkggy.js"></script>';
    expect(loadedEntry()).toBe("/assets/main-gDMPkggy.js");
    document.head.innerHTML = "";
    expect(loadedEntry()).toBeNull();
  });

  it("is stale only when both names are known and differ", () => {
    expect(isStaleBuild("/assets/main-old.js", "/assets/main-new.js")).toBe(true);
    expect(isStaleBuild("/assets/main-new.js", "/assets/main-new.js")).toBe(false);
    expect(isStaleBuild(null, "/assets/main-new.js")).toBe(false);
    expect(isStaleBuild("/assets/main-old.js", null)).toBe(false);
  });
});
