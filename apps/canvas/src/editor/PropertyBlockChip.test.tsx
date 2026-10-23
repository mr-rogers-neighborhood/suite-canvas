import type { FieldDefinition } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PropertyBlockChip } from "./PropertyBlockChip";

function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id: "owner",
    name: "Owner",
    kind: "text",
    required: false,
    order: 0,
    options: [],
    ...overrides,
  };
}

describe("PropertyBlockChip", () => {
  it("should render the field name and its value on one line", () => {
    render(
      <PropertyBlockChip field={field()} value="Ada" onCommit={() => {}} onOpenPanel={() => {}} />,
    );

    const block = screen.getByTestId("property-block");
    expect(block).toHaveAttribute("data-field-id", "owner");
    expect(block).toHaveTextContent("Owner");
    expect(screen.getByTestId("property-block-value")).toHaveTextContent("Ada");
  });

  it("should write one value when the inline input commits", () => {
    const onCommit = vi.fn();
    render(
      <PropertyBlockChip field={field()} value="Ada" onCommit={onCommit} onOpenPanel={() => {}} />,
    );

    fireEvent.click(screen.getByTestId("property-block-value"));
    const input = screen.getByTestId("property-block-input");
    fireEvent.change(input, { target: { value: "Grace Hopper" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Grace Hopper");
  });

  it("should cancel on Escape without writing", () => {
    const onCommit = vi.fn();
    render(
      <PropertyBlockChip field={field()} value="Ada" onCommit={onCommit} onOpenPanel={() => {}} />,
    );

    fireEvent.click(screen.getByTestId("property-block-value"));
    const input = screen.getByTestId("property-block-input");
    fireEvent.change(input, { target: { value: "Grace" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("property-block-input")).not.toBeInTheDocument();
  });

  it("should commit a number as a number and clear an empty one", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <PropertyBlockChip
        field={field({ id: "estimate", name: "Estimate", kind: "number" })}
        value={3}
        onCommit={onCommit}
        onOpenPanel={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("property-block-value"));
    const input = screen.getByTestId("property-block-input");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(5);

    rerender(
      <PropertyBlockChip
        field={field({ id: "estimate", name: "Estimate", kind: "number" })}
        value={5}
        onCommit={onCommit}
        onOpenPanel={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("property-block-value"));
    const cleared = screen.getByTestId("property-block-input");
    fireEvent.change(cleared, { target: { value: "" } });
    fireEvent.blur(cleared);
    expect(onCommit).toHaveBeenLastCalledWith(null);
  });

  it("should toggle a checkbox and clear it on the second click", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <PropertyBlockChip
        field={field({ id: "done", name: "Done", kind: "checkbox" })}
        value={false}
        onCommit={onCommit}
        onOpenPanel={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("property-block-value"));
    expect(onCommit).toHaveBeenLastCalledWith(true);

    rerender(
      <PropertyBlockChip
        field={field({ id: "done", name: "Done", kind: "checkbox" })}
        value={true}
        onCommit={onCommit}
        onOpenPanel={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("property-block-value"));
    expect(onCommit).toHaveBeenLastCalledWith(null);
  });

  it("should show select and multi-select labels rather than ids", () => {
    const status = field({
      id: "status",
      name: "Status",
      kind: "select",
      options: [
        { id: "opt-todo", label: "To do", order: 0 },
        { id: "opt-done", label: "Done", order: 1 },
      ],
    });
    const { rerender } = render(
      <PropertyBlockChip
        field={status}
        value="opt-done"
        onCommit={() => {}}
        onOpenPanel={() => {}}
      />,
    );
    expect(screen.getByTestId("property-block-value")).toHaveTextContent("Done");

    const areas = field({
      id: "areas",
      name: "Areas",
      kind: "multiSelect",
      options: [
        { id: "a", label: "Research", order: 0 },
        { id: "b", label: "Design", order: 1 },
      ],
    });
    rerender(
      <PropertyBlockChip
        field={areas}
        value={["a", "b"]}
        onCommit={() => {}}
        onOpenPanel={() => {}}
      />,
    );
    expect(screen.getByTestId("property-block-value")).toHaveTextContent("Research, Design");
  });

  it("should open the panel instead of editing a card or multi-select value", () => {
    const onOpenPanel = vi.fn();
    const { rerender } = render(
      <PropertyBlockChip
        field={field({ id: "related", name: "Related", kind: "card" })}
        value="c2"
        cardLabel="Onboarding friction"
        onCommit={() => {}}
        onOpenPanel={onOpenPanel}
      />,
    );

    expect(screen.getByTestId("property-block-value")).toHaveTextContent("Onboarding friction");
    fireEvent.click(screen.getByTestId("property-block-value"));
    expect(onOpenPanel).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("property-block-input")).not.toBeInTheDocument();

    rerender(
      <PropertyBlockChip
        field={field({ id: "areas", name: "Areas", kind: "multiSelect" })}
        value={["a"]}
        onCommit={() => {}}
        onOpenPanel={onOpenPanel}
      />,
    );
    fireEvent.click(screen.getByTestId("property-block-value"));
    expect(onOpenPanel).toHaveBeenCalledTimes(2);
  });

  it("should render an unshared linked card inert instead of unavailable", () => {
    const onOpenPanel = vi.fn();
    render(
      <PropertyBlockChip
        field={field({ id: "related", name: "Related", kind: "card" })}
        value="card-2"
        cardLabel="Private card"
        cardPresence="stub"
        onCommit={() => {}}
        onOpenPanel={onOpenPanel}
      />,
    );

    const value = screen.getByTestId("property-block-value");
    expect(value).toHaveTextContent("Private card");
    expect(value).toHaveTextContent("not shared");
    expect(value).toHaveAttribute("data-not-shared", "true");
    expect(value).toHaveAttribute("aria-label", "Private card \u2014 not shared");
    expect(value.tagName).toBe("SPAN");

    fireEvent.click(value);
    expect(onOpenPanel).not.toHaveBeenCalled();
  });

  it("should still call a card with no known title unavailable", () => {
    render(
      <PropertyBlockChip
        field={field({ id: "related", name: "Related", kind: "card" })}
        value="card-9"
        cardPresence="missing"
        onCommit={() => {}}
        onOpenPanel={() => {}}
      />,
    );

    const value = screen.getByTestId("property-block-value");
    expect(value).toHaveTextContent("Unavailable card");
    expect(value).not.toHaveAttribute("data-not-shared");
  });

  it("should not call an untitled stub Untitled", () => {
    render(
      <PropertyBlockChip
        field={field({ id: "related", name: "Related", kind: "card" })}
        value="card-2"
        cardLabel="Untitled"
        cardPresence="stub"
        onCommit={() => {}}
        onOpenPanel={() => {}}
      />,
    );

    const value = screen.getByTestId("property-block-value");
    expect(value).toHaveTextContent("Not shared");
    expect(value).not.toHaveTextContent("Untitled");
  });

  it("should render a muted placeholder when the field is gone", () => {
    render(
      <PropertyBlockChip
        field={undefined}
        value="Ada"
        onCommit={() => {}}
        onOpenPanel={() => {}}
      />,
    );

    expect(screen.getByTestId("property-block-missing")).toHaveTextContent("Missing field");
    expect(screen.queryByTestId("property-block")).not.toBeInTheDocument();
  });

  it("should render an empty value without an id", () => {
    render(
      <PropertyBlockChip
        field={field()}
        value={undefined}
        onCommit={() => {}}
        onOpenPanel={() => {}}
      />,
    );

    expect(screen.getByTestId("property-block-value")).toHaveTextContent("\u2014");
  });
});
