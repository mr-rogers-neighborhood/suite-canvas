import type { FieldDefinition } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  fieldKindEntry,
  registeredFieldKinds,
  registerFieldKind,
  resetFieldKinds,
} from "./fieldKindRegistry";

const field: FieldDefinition = {
  id: "field-1",
  name: "Score",
  kind: "number",
  required: false,
  order: 0,
  options: [],
};

describe("field kind registry", () => {
  afterEach(() => resetFieldKinds());

  it("starts empty: the built-in kinds are handled by the panel's own switch", () => {
    expect(registeredFieldKinds()).toEqual([]);
    expect(fieldKindEntry("number")).toBeUndefined();
  });

  it("registers a kind with an editor", () => {
    registerFieldKind({
      kind: "rating",
      editor: () => <output data-testid="rating-editor">stars</output>,
    });
    expect(registeredFieldKinds()).toEqual(["rating"]);
    const entry = fieldKindEntry("rating");
    expect(entry).toBeDefined();
    if (!entry) return;
    const Editor = entry.editor;
    render(<Editor field={field} value={5} onCommit={() => {}} />);
    expect(screen.getByTestId("rating-editor")).toHaveTextContent("stars");
  });

  it("is replaceable: the last registration for a kind wins", () => {
    registerFieldKind({ kind: "list", editor: () => <span>first</span> });
    registerFieldKind({ kind: "list", editor: () => <span>second</span> });
    expect(registeredFieldKinds()).toEqual(["list"]);
    const entry = fieldKindEntry("list");
    if (!entry) throw new Error("registered");
    const Editor = entry.editor;
    render(<Editor field={field} value={undefined} onCommit={() => {}} />);
    expect(screen.getByText("second")).toBeInTheDocument();
  });
});
