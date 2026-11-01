import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookBacklinksView } from "./BookBacklinks";

/**
 * A book's cards, in the reader.
 *
 * The two lists answer different questions and are labelled differently: a card made from the book is what a reader is
 * looking for again, while a card that mentions the book is context. A row press peeks at the card, which is the only
 * way back to it from inside the book.
 */
function renderView(patch: Partial<Parameters<typeof BookBacklinksView>[0]> = {}) {
  const onOpen = vi.fn();
  render(
    <BookBacklinksView
      produced={["card-a"]}
      referencing={[{ cardId: "card-b", reason: { kind: "mentions" } }]}
      titleOf={(cardId) => (cardId === "card-a" ? "Spacing works" : "A note about the book")}
      onOpen={onOpen}
      {...patch}
    />,
  );
  return { onOpen };
}

describe("a book's backlinks", () => {
  it("should count the cards it produced and list them by title", () => {
    renderView();
    expect(screen.getByText("1 card from this book")).toBeInTheDocument();
    expect(screen.getByText("Spacing works")).toBeInTheDocument();
  });

  it("should say why a card that is not from the book is listed", () => {
    renderView();
    expect(screen.getByText("mentions this book")).toBeInTheDocument();
  });

  it("should name the property a card points at the book with", () => {
    renderView({
      referencing: [{ cardId: "card-b", reason: { kind: "property", fieldName: "Relates to" } }],
    });
    expect(screen.getByText("Relates to")).toBeInTheDocument();
  });

  it("should open the card a row names", () => {
    const { onOpen } = renderView();
    fireEvent.click(screen.getByText("Spacing works"));
    expect(onOpen).toHaveBeenCalledWith("card-a");
  });

  it("should say what a book with nothing linked to it is waiting for", () => {
    renderView({ produced: [], referencing: [] });
    expect(screen.getByTestId("book-backlinks-empty")).toHaveTextContent(
      "Nothing is linked to this book yet.",
    );
  });

  it("should keep the produced list out of the panel when a book has made no cards", () => {
    renderView({ produced: [] });
    expect(screen.queryByText(/from this book$/u)).toBeNull();
  });
});
