import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChapterNotice } from "./ChapterNotice";

/**
 * What the chapter lost.
 *
 * The report was built on every chapter and read by nothing, so a passage whose pictures were refused looked like a
 * passage that never had any. Two refusals are worth saying out loud; the routine ones are not.
 */
describe("a chapter's notice", () => {
  it("should say nothing when the chapter kept everything a reader would notice", () => {
    const { container } = render(
      <ChapterNotice
        report={{ dropped: ["style", "link"], remote: [], links: 2, hadScript: false }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("should name the pictures a book pointed outside itself for", () => {
    render(
      <ChapterNotice
        report={{
          dropped: [],
          remote: ["https://example.com/a.png", "https://example.com/b.png"],
          links: 0,
          hadScript: false,
        }}
      />,
    );
    expect(screen.getByTestId("reader-chapter-notice")).toHaveTextContent(
      "2 pictures were not loaded",
    );
    // The why, because the reason is a privacy decision rather than a bug.
    expect(screen.getByTestId("reader-chapter-notice")).toHaveTextContent("outside itself");
  });

  it("should count one picture in the singular", () => {
    render(
      <ChapterNotice
        report={{ dropped: [], remote: ["https://example.com/a.png"], links: 0, hadScript: false }}
      />,
    );
    expect(screen.getByTestId("reader-chapter-notice")).toHaveTextContent("One picture was not");
  });

  it("should say that script was removed", () => {
    render(
      <ChapterNotice report={{ dropped: ["script"], remote: [], links: 0, hadScript: true }} />,
    );
    expect(screen.getByTestId("reader-chapter-notice")).toHaveTextContent("Script");
  });
});
