import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CORS_HEADERS } from "./http.js";

/**
 * Every custom request header the browser app sends must be named in
 * `access-control-allow-headers`, or Chromium refuses the preflight and the
 * request never leaves the page.
 *
 * This was a shipped bug: `pasteImages.ts` sent `x-suite-attachment-id`, the
 * allowlist did not name it, and *every cross-origin image upload failed*. The
 * local IndexedDB fallback hid it, so the only visible symptom was that a share
 * viewer saw a placeholder for an image the author could still see. An e2e run
 * against the dev server caught it, which is one environment too few.
 *
 * A source scan is crude but it is the only place that can see both sides: the
 * app and the relay are separate packages and neither may import the other. A
 * false failure is loud and fixed by adding the header; the alternative is a
 * silent one.
 */
const CANVAS_SRC = join(import.meta.dirname, "..", "..", "canvas", "src");

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** Custom headers only: `content-type` and `authorization` are standard. */
const CUSTOM_HEADER = /["'](x-suite-[a-z-]+)["']/gu;

function sentHeaders(): Map<string, string[]> {
  const byHeader = new Map<string, string[]>();
  for (const path of sourceFiles(CANVAS_SRC)) {
    if (path.includes(".test.") || path.includes(".stories.")) continue;
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(CUSTOM_HEADER)) {
      const name = match[1];
      if (!name) continue;
      const files = byHeader.get(name) ?? [];
      if (!files.includes(path)) files.push(path);
      byHeader.set(name, files);
    }
  }
  return byHeader;
}

describe("CORS header allowlist", () => {
  it("names every custom header the app sends", () => {
    const allowed = (CORS_HEADERS["access-control-allow-headers"] ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase());

    const sent = sentHeaders();
    // A guard that scans nothing passes vacuously, which is worse than no guard.
    expect(sent.size, "no custom headers found in the canvas source").toBeGreaterThan(0);

    for (const [header, files] of sent) {
      expect(
        allowed,
        `${files.join(", ")} sends "${header}" but the relay does not allow it`,
      ).toContain(header);
    }
  });

  it("still allows the browser's own conditional headers", () => {
    const allowed = CORS_HEADERS["access-control-allow-headers"] ?? "";
    for (const header of ["content-type", "authorization"]) {
      expect(allowed).toContain(header);
    }
  });
});
