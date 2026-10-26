import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnnotationRead } from "../canvas/annotations/annotationRecord";
import { AnnotationReader } from "./AnnotationReader";

const text = "A study of retrieval practice shows that testing beats rereading.";

const read: AnnotationRead = {
  ok: true,
  record: {
    cardId: "note-1",
    sourceCardId: "paper-1",
    quote: "retrieval practice",
    start: 11,
    end: 29,
  },
};

const source = { title: "Roediger & Karpicke", text };

describe("AnnotationReader", () => {
  it("should show the passage at the range the source confirms", () => {
    render(<AnnotationReader read={read} source={source} />);
    expect(screen.getByTestId("annotation-reader")).toHaveAttribute("data-state", "intact");
    expect(screen.getByText("retrieval practice").tagName).toBe("MARK");
  });

  it("should say a moved passage followed its source without asking the reader to act", () => {
    render(<AnnotationReader read={read} source={{ ...source, text: `Preface. ${text}` }} />);
    expect(screen.getByTestId("annotation-reader")).toHaveAttribute("data-state", "shifted");
    expect(screen.queryByTestId("annotation-problem")).toBeNull();
    expect(screen.getByText("retrieval practice")).toBeInTheDocument();
  });

  it("should name a stale range and keep the quote the reader wrote", () => {
    render(<AnnotationReader read={read} source={{ ...source, text: "Rewritten entirely." }} />);
    expect(screen.getByTestId("annotation-reader")).toHaveAttribute("data-state", "stale");
    expect(screen.getByTestId("annotation-problem")).toHaveTextContent(
      "The passage this annotation quoted is no longer in the source",
    );
    expect(screen.getByTestId("annotation-excerpt")).toHaveTextContent("retrieval practice");
  });

  it("should refuse to highlight one of two matches", () => {
    render(
      <AnnotationReader
        read={read}
        source={{ ...source, text: `Intro. ${text} Again: retrieval practice.` }}
      />,
    );
    expect(screen.getByTestId("annotation-reader")).toHaveAttribute("data-state", "ambiguous");
    expect(screen.getByTestId("annotation-problem")).toHaveTextContent("more than one passage");
  });

  it("should say the source is missing, and offer no route to it", () => {
    const onOpenSource = vi.fn();
    render(<AnnotationReader read={read} source={null} onOpenSource={onOpenSource} />);
    expect(screen.getByTestId("annotation-problem")).toHaveTextContent(
      "The source this annotation points into is gone",
    );
    expect(screen.queryByTestId("annotation-open-source")).toBeNull();
  });

  it("should offer one route back to the source", () => {
    const onOpenSource = vi.fn();
    render(<AnnotationReader read={read} source={source} onOpenSource={onOpenSource} />);
    fireEvent.click(screen.getByTestId("annotation-open-source"));
    expect(onOpenSource).toHaveBeenCalledWith("paper-1");
  });

  it("should name the fields a plain card is missing instead of drawing an empty quote", () => {
    render(
      <AnnotationReader
        read={{
          ok: false,
          code: "annotation.record.incomplete",
          fields: ["source", "quote"],
        }}
        source={source}
      />,
    );
    expect(screen.getByTestId("annotation-reader")).toHaveAttribute("data-state", "incomplete");
    expect(screen.getByTestId("annotation-problem")).toHaveTextContent("source, quote");
    expect(screen.queryByTestId("annotation-excerpt")).toBeNull();
  });
});
