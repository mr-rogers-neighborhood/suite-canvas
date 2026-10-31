import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useHandbookStore } from "../store/handbookStore";
import { useUiStore } from "../store/useUiStore";
import { HandbookBubble } from "./HandbookBubble";

beforeEach(() => {
  useHandbookStore.setState({
    open: false,
    articleId: null,
    lastArticleId: null,
    scope: [],
    pane: "handbook",
    picking: false,
    collapsed: { x: 40, y: 40, width: 196, height: 36 },
    expanded: { x: 40, y: 40, width: 360, height: 460 },
  });
  useUiStore.setState({
    activeBoardId: "board-1",
    purpose: "explore",
    selectedNodeIds: [],
  });
  window.localStorage.clear();
});

/** A shell region the handbook can see, which is all the presence check reads. */
function TitleBar() {
  return <div data-handbook-region="title-bar" />;
}

describe("the handbook bubble", () => {
  it("should count what on screen is documented, without counting itself", async () => {
    render(
      <>
        <TitleBar />
        <HandbookBubble />
      </>,
    );
    expect(screen.getByTestId("handbook-pill")).toBeInTheDocument();
    // One region, one count: the panel documents itself but does not pad its own badge, or the
    // number could never be zero and "nothing here is documented" would be unreachable.
    expect((await screen.findByTestId("handbook-count")).textContent).toBe("1");
  });

  it("should not list its own article, because the reader is already in it", async () => {
    render(<HandbookBubble />);
    fireEvent.click(screen.getByTestId("handbook-pill"));

    expect(await screen.findByTestId("handbook-empty")).toBeInTheDocument();
    expect(screen.queryAllByTestId("handbook-row")).toHaveLength(0);
  });

  it("should list the articles that match the screen, not every article", async () => {
    render(
      <>
        <TitleBar />
        <HandbookBubble />
      </>,
    );
    fireEvent.click(screen.getByTestId("handbook-pill"));

    const rows = await screen.findAllByTestId("handbook-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(10);
    expect(rows.some((row) => row.getAttribute("data-article-id") === "chrome/title-bar")).toBe(
      true,
    );
  });

  it("should open an article and come back to the list", async () => {
    render(
      <>
        <TitleBar />
        <HandbookBubble />
      </>,
    );
    fireEvent.click(screen.getByTestId("handbook-pill"));
    fireEvent.click(
      (await screen.findAllByTestId("handbook-row")).find(
        (row) => row.getAttribute("data-article-id") === "chrome/title-bar",
      ) as HTMLElement,
    );

    expect(screen.getByTestId("handbook-article")).toHaveAttribute(
      "data-article-id",
      "chrome/title-bar",
    );
    expect(screen.getByTestId("handbook-body").textContent).toContain("title bar");

    fireEvent.click(screen.getByTestId("handbook-back"));
    expect(screen.getByTestId("handbook-list")).toBeInTheDocument();
  });

  it("should send feedback from the same panel, naming the article", async () => {
    render(
      <>
        <TitleBar />
        <HandbookBubble />
      </>,
    );
    fireEvent.click(screen.getByTestId("handbook-pill"));
    fireEvent.click(
      (await screen.findAllByTestId("handbook-row")).find(
        (row) => row.getAttribute("data-article-id") === "chrome/title-bar",
      ) as HTMLElement,
    );
    fireEvent.click(screen.getByTestId("handbook-feedback"));

    expect(screen.getByTestId("feedback-text")).toBeInTheDocument();
    expect(screen.getByTestId("feedback-context")).toHaveTextContent("The title bar");
  });

  it("should drag without opening when the press travelled", () => {
    render(
      <>
        <TitleBar />
        <HandbookBubble />
      </>,
    );
    const pill = screen.getByTestId("handbook-pill");
    fireEvent.pointerDown(pill, { clientX: 50, clientY: 50 });
    fireEvent.pointerMove(pill, { clientX: 120, clientY: 90 });
    fireEvent.pointerUp(pill, { clientX: 120, clientY: 90 });
    fireEvent.click(pill);

    // A drag moves the pill; the click that follows a drag is not an open.
    expect(useHandbookStore.getState().open).toBe(false);
    expect(useHandbookStore.getState().collapsed.x).toBe(110);
  });

  it("should open the article a single selected card names, in explain mode", () => {
    useUiStore.setState({ purpose: "explain", selectedNodeIds: ["missing-card"] });
    render(<HandbookBubble />);
    // A selection the document does not contain is not something to explain, so the panel
    // stays shut rather than opening on a guess.
    expect(useHandbookStore.getState().open).toBe(false);
  });
});
