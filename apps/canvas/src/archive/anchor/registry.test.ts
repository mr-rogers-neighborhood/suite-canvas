import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AnnotationAnchor,
  type AnnotationMedium,
  annotationMedium,
  excerptOf,
  forgetAnnotationMediums,
  openAtAnchor,
  registerAnnotationMedium,
  registeredAnchorKinds,
} from "./index";

/**
 * The guard for the media that do not exist yet.
 *
 * A book's quote is the only medium today, and the next two are a PDF page and a span of video. If either of
 * them would have to change the record, the styles, the field kind or the promotion command, this file is
 * where that shows up — a fake PDF and a fake video stand in for them and exercise everything above the anchor
 * with no EPUB involved at all.
 */

function fakeMedium(kind: AnnotationAnchor["kind"]): AnnotationMedium & {
  opened: AnnotationAnchor[];
} {
  const opened: AnnotationAnchor[] = [];
  return {
    anchorKind: kind,
    describe: (anchor) => `somewhere in ${anchor.locator}`,
    // The mock's own kind, not the anchor's: a video's excerpt is a time range and a page's is text.
    excerpt: () => (kind === "time" ? "0:12–0:30" : "a sentence"),
    openAt: (anchor) => {
      opened.push(anchor);
    },
    opened,
  };
}

const PDF: AnnotationAnchor = {
  kind: "page",
  locator: "the report",
  page: 12,
  rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }],
};

const VIDEO: AnnotationAnchor = {
  kind: "time",
  locator: "episode 1",
  startMs: 12_000,
  endMs: 30_000,
};

afterEach(() => {
  forgetAnnotationMediums();
});

describe("the medium registry", () => {
  it("should accept a PDF and a video medium, which is the whole point of the union", () => {
    registerAnnotationMedium(fakeMedium("page"));
    registerAnnotationMedium(fakeMedium("time"));
    expect(registeredAnchorKinds().sort()).toEqual(["page", "time"]);
  });

  it("should take the excerpt from the medium that can read the anchor", () => {
    registerAnnotationMedium(fakeMedium("time"));
    expect(excerptOf(VIDEO, undefined)).toBe("0:12–0:30");
  });

  it("should prefer an excerpt the record stored, so a card reads the same after the medium changes", () => {
    registerAnnotationMedium(fakeMedium("page"));
    expect(excerptOf(PDF, "the sentence that was selected")).toBe("the sentence that was selected");
  });

  it("should say so rather than crash when this build has no medium for the anchor", () => {
    // A document may arrive carrying a PDF annotation on a build with no PDF module.
    expect(excerptOf(PDF, undefined)).toBeNull();
    expect(openAtAnchor(PDF)).toBe(false);
    expect(annotationMedium("page")).toBeUndefined();
  });

  it("should open the source through the registered medium and report that it did", () => {
    const pdf = fakeMedium("page");
    registerAnnotationMedium(pdf);
    expect(openAtAnchor(PDF)).toBe(true);
    expect(pdf.opened).toEqual([PDF]);
  });

  it("should let the last registration win, so a hot reload cannot double-handle an anchor kind", () => {
    const first = fakeMedium("page");
    const second = fakeMedium("page");
    registerAnnotationMedium(first);
    registerAnnotationMedium(second);
    openAtAnchor(PDF);
    expect(first.opened).toEqual([]);
    expect(second.opened).toEqual([PDF]);
  });

  it("should hand every anchor kind to the same three questions", () => {
    // If a medium ever needed a fourth call, the interface is what changes, and this asserts that it has not.
    const medium = fakeMedium("page");
    const spy = vi.fn(medium.describe);
    registerAnnotationMedium({ ...medium, describe: spy });
    annotationMedium("page")?.describe(PDF);
    expect(spy).toHaveBeenCalledWith(PDF);
  });
});
