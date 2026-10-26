import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { StylesDialog } from "./StylesDialog";

/**
 * The rule list (ADR-0071).
 *
 * What has to be true: a reader can see every rule grouped the way the resolver walks them, edit one with
 * the same controls the inspector uses, reorder it, and delete it — and a viewer can do none of the writes.
 */

beforeEach(() => {
  useCanvasStore.setState({ workspace: new WorkspaceDocument() });
});

function seedRules() {
  const doc = useCanvasStore.getState().workspace;
  const board = doc.createBoard({ name: "Home" });
  doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  doc.setStyleRules([
    {
      id: "r-global",
      name: "Everywhere",
      order: 0,
      scope: { kind: "global" },
      style: { radius: 6 },
    },
    {
      id: "r-kind",
      name: "Every card",
      order: 1,
      scope: { kind: "kind", id: "card" },
      style: { shape: "diamond" },
    },
    { id: "r-dock", name: "Every dock", order: 2, scope: { kind: "shell", id: "dock" }, style: {} },
  ]);
  return doc;
}

describe("StylesDialog", () => {
  it("groups rules by the rung the resolver walks, in that order", () => {
    seedRules();
    render(<StylesDialog open canEdit onClose={() => {}} />);

    const groups = ["global", "kind", "shell"].map((kind) =>
      screen.getByTestId(`styles-group-${kind}`),
    );
    expect(groups[0]).toHaveTextContent("Everywhere");
    expect(groups[1]).toHaveTextContent("Every card");
    expect(groups[2]).toHaveTextContent("Every dock");
  });

  it("says a rule that names nothing instead of leaving the row blank", () => {
    seedRules();
    render(<StylesDialog open canEdit onClose={() => {}} />);

    expect(screen.getByTestId("styles-rule-r-dock")).toHaveTextContent("Names nothing yet");
  });

  it("edits the selected rule with the same controls the inspector uses", () => {
    const doc = seedRules();
    render(<StylesDialog open canEdit onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("styles-select-r-kind"));
    // The Style tab, not a second form: the same shape chips, writing to the rule.
    fireEvent.click(screen.getByTestId("style-shape-pill"));

    expect(doc.styleRules().find((rule) => rule.id === "r-kind")?.style.shape).toBe("pill");
    // The rule's identity is untouched by an edit.
    expect(doc.styleRules().find((rule) => rule.id === "r-kind")?.scope).toEqual({
      kind: "kind",
      id: "card",
    });
  });

  it("reorders with the same number the resolver compares", () => {
    const doc = seedRules();
    render(<StylesDialog open canEdit onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("styles-down-r-global"));

    const ordered = doc.styleRules().map((rule) => rule.id);
    expect(ordered.indexOf("r-global")).toBeGreaterThan(ordered.indexOf("r-kind"));
  });

  it("deletes a rule and moves the editor to what is left", () => {
    const doc = seedRules();
    render(<StylesDialog open canEdit onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("styles-select-r-global"));
    fireEvent.click(screen.getByTestId("styles-delete-r-global"));

    expect(doc.styleRules().map((rule) => rule.id)).not.toContain("r-global");
    // The pane follows the list rather than naming a rule that no longer exists.
    expect(screen.queryByTestId("styles-rule-r-global")).toBeNull();
    expect(screen.getByTestId("style-tab")).toBeTruthy();
  });

  it("creates a rule for a scope nobody has claimed, and selects it", () => {
    const doc = seedRules();
    render(<StylesDialog open canEdit onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("styles-add-shell-app-bar"));

    const created = doc.styleRules().find((rule) => rule.scope.id === "app-bar");
    expect(created?.name).toBe("Every app bar");
    expect(created?.style).toEqual({});
    expect(screen.getByTestId(`styles-rule-${created?.id}`)).toHaveAttribute("data-active", "true");
  });

  it("closes on Escape, and does none of the writes for a viewer", () => {
    const doc = seedRules();
    const onClose = vi.fn();
    render(<StylesDialog open canEdit={false} onClose={onClose} />);

    expect(screen.getByTestId("styles-delete-r-kind")).toBeDisabled();
    expect(screen.queryByTestId("styles-add-global")).toBeNull();
    // Nothing was written by rendering a read-only list.
    expect(doc.styleRules()).toHaveLength(3);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says so when there are no rules, rather than showing an empty box", () => {
    const doc = useCanvasStore.getState().workspace;
    doc.createBoard({ name: "Home" });
    render(<StylesDialog open canEdit onClose={() => {}} />);

    expect(screen.getByTestId("styles-empty")).toHaveTextContent("No rules yet");
  });
});
