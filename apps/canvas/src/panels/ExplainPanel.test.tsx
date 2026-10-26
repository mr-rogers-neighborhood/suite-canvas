import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { ExplainPanel } from "./ExplainPanel";

const panel = () => screen.queryByTestId("explain-panel");

beforeEach(() => {
  useUiStore.setState({ purpose: "explore", selectedNodeIds: [] });
});

describe("ExplainPanel", () => {
  it("is not on the canvas unless the canvas is in explain mode", () => {
    render(<ExplainPanel context={{ entities: [], links: [], partial: false }} />);

    // A purpose's surface belongs to the purpose: an empty context panel sitting over
    // an exploring canvas would be chrome with nothing to say.
    expect(panel()).toBeNull();
  });

  it("asks for a selection when there is nothing to explain", () => {
    useUiStore.setState({ purpose: "explain" });
    render(<ExplainPanel context={{ entities: [], links: [], partial: false }} />);

    expect(panel()).not.toBeNull();
    expect(screen.getByTestId("explain-count")).toHaveTextContent("Nothing selected");
    expect(screen.getByTestId("explain-empty")).toHaveTextContent("Select cards");
    expect(screen.queryByTestId("explain-entities")).toBeNull();
  });

  it("gathers the entities, their kinds and the links between them", () => {
    useUiStore.setState({ purpose: "explain" });
    render(
      <ExplainPanel
        context={{
          entities: [
            {
              id: "a",
              title: "Anchor",
              kind: "note",
              fields: [{ label: "Status", value: "Draft" }],
            },
            { id: "b", title: "Target", kind: "quote", fields: [] },
          ],
          links: [{ id: "e", from: "Anchor", to: "Target", kind: "depends on" }],
          partial: false,
        }}
      />,
    );

    expect(screen.getByTestId("explain-count")).toHaveTextContent("2 things · 1 link");
    expect(screen.getAllByTestId("explain-entity")).toHaveLength(2);
    expect(screen.getAllByTestId("explain-kind").map((node) => node.textContent)).toEqual([
      "note",
      "quote",
    ]);
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByTestId("explain-link")).toHaveTextContent("Anchor → Target");
    expect(screen.getByTestId("explain-link")).toHaveTextContent("depends on");
  });

  it("says when part of the selection cannot be explained", () => {
    useUiStore.setState({ purpose: "explain" });
    render(
      <ExplainPanel
        context={{
          entities: [{ id: "a", title: "Anchor", kind: "note", fields: [] }],
          links: [],
          partial: true,
        }}
      />,
    );

    expect(screen.getByTestId("explain-partial")).toHaveTextContent("cannot be explained");
  });

  it("states why there is no save button", () => {
    useUiStore.setState({ purpose: "explain" });
    render(<ExplainPanel context={{ entities: [], links: [], partial: false }} />);

    // The context is UI state until it is saved as a view (ADR-0043), and a panel with
    // no affordance otherwise reads as unfinished rather than deliberate.
    expect(screen.getByTestId("explain-footer")).toHaveTextContent("Saving it as a view");
  });
});
