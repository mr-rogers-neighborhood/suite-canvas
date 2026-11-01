import { describe, expect, it } from "vitest";
import { rewriteLink, sanitiseChapter } from "./sanitise";

const BASE = "OEBPS/text/chapter1.xhtml";

function htmlOf(fragment: string): string {
  return sanitiseChapter(
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${fragment}</body></html>`,
    BASE,
  ).html;
}

describe("sanitising a chapter", () => {
  it("should keep the book's words and its semantic tags", () => {
    const html = htmlOf("<h1>One</h1><p>A <em>sentence</em> and <strong>another</strong>.</p>");
    expect(html).toContain("<h1>One</h1>");
    expect(html).toContain("<em>sentence</em>");
    expect(html).toContain("<strong>another</strong>");
  });

  it("should drop a script whole and say it did", () => {
    const { html, report } = sanitiseChapter(
      `<html><body><p>Before</p><script>alert(1)</script><p>After</p></body></html>`,
      BASE,
    );
    expect(html).not.toContain("alert");
    expect(html).toContain("Before");
    expect(html).toContain("After");
    expect(report.hadScript).toBe(true);
    expect(report.dropped).toContain("script");
  });

  it("should drop every event handler attribute, whatever it is called", () => {
    const html = htmlOf(`<p onclick="steal()" onmouseover="x()" onload="y()">Text</p>`);
    expect(html).toBe("<p>Text</p>");
  });

  it("should drop a frame, an object and an embedded document", () => {
    const { report } = sanitiseChapter(
      `<html><body><p>T</p><iframe src="https://example.com"></iframe><object data="x"></object><embed src="y"></body></html>`,
      BASE,
    );
    expect(report.dropped).toEqual(["embed", "iframe", "object"]);
  });

  it("should drop the book's own stylesheet and keep the text", () => {
    const html = htmlOf(`<style>body { font-family: Arial }</style><p>Text</p>`);
    expect(html).not.toContain("font-family");
    expect(html).toBe("<p>Text</p>");
  });

  it("should unwrap an element it does not know rather than lose its children", () => {
    // A book's own wrapper is the chapter, and dropping it whole would drop a paragraph of the book.
    const html = htmlOf(`<epub:switch><p>Inside a wrapper</p></epub:switch>`);
    expect(html).toContain("<p>Inside a wrapper</p>");
    expect(html).not.toContain("epub");
  });

  it("should keep a relative image and resolve it against the chapter", () => {
    const html = htmlOf(`<p><img src="../images/cover.png" alt="A cover"/></p>`);
    expect(html).toContain('src="OEBPS/images/cover.png"');
    expect(html).toContain('alt="A cover"');
  });

  it("should refuse a remote image rather than fetch it at render time", () => {
    const { html, report } = sanitiseChapter(
      `<html><body><p><img src="https://tracker.example/pixel.gif"/></p><p>Text</p></body></html>`,
      BASE,
    );
    expect(html).not.toContain("tracker.example");
    expect(html).toContain("Text");
    expect(report.remote).toEqual(["https://tracker.example/pixel.gif"]);
  });

  it("should keep a data image, because it is already in the document", () => {
    const html = htmlOf(`<p><img src="data:image/png;base64,AAAA"/></p>`);
    expect(html).toContain("data:image/png;base64,AAAA");
  });

  it("should turn an internal link into reader navigation and refuse an external one", () => {
    const { html, report } = sanitiseChapter(
      `<html><body><p><a href="../text/chapter2.xhtml#deeper">Onward</a> <a href="https://example.com">Out</a></p></body></html>`,
      BASE,
    );
    // The fragment survives, because a footnote points at a place in the notes file rather than at its first line.
    expect(html).toContain('href="#OEBPS/text/chapter2.xhtml#deeper"');
    expect(html).not.toContain("example.com");
    expect(html).toContain("Out");
    expect(report.links).toBe(1);
  });

  it("should read a chapter that is not well-formed XHTML, the forgiving way", () => {
    const { html } = sanitiseChapter(
      `<html><body><p>Half a paragraph<br><p>and another</body></html>`,
      BASE,
    );
    expect(html).toContain("Half a paragraph");
    expect(html).toContain("and another");
  });

  it("should keep a table, a list and a footnote's shape", () => {
    const html = htmlOf(
      `<table><tr><th>One</th></tr><tr><td>2</td></tr></table><ol><li>a</li></ol>`,
    );
    expect(html).toContain("<th>One</th>");
    expect(html).toContain("<td>2</td>");
    expect(html).toContain("<li>a</li>");
  });
});

describe("resolving the paths a book writes", () => {
  it("should resolve a chapter path against the chapter's own directory", () => {
    expect(rewriteLink("chapter2.xhtml", BASE)).toBe("#OEBPS/text/chapter2.xhtml");
    expect(rewriteLink("../images/a.png", BASE)).toBe("#OEBPS/images/a.png");
  });

  it("should keep a fragment local", () => {
    expect(rewriteLink("#deeper", BASE)).toBe("#deeper");
  });

  it("should keep the fragment of a link into another document", () => {
    // A footnote points at a *place* in the notes file. Dropping the fragment lands the reader at its first line.
    expect(rewriteLink("notes.xhtml#n3", BASE)).toBe("#OEBPS/text/notes.xhtml#n3");
    expect(rewriteLink("../notes.xhtml#n3", BASE)).toBe("#OEBPS/notes.xhtml#n3");
  });

  it("should refuse a link that leaves the book", () => {
    expect(rewriteLink("https://example.com", BASE)).toBeNull();
    expect(rewriteLink("mailto:a@example.com", BASE)).toBeNull();
  });
});
