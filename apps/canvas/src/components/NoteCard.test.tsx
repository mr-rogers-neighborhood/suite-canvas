import type { GraphNode } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoteCard } from "./NoteCard";

const note: GraphNode = {
  id: "n1",
  kind: "note",
  position: { x: 0, y: 0 },
  createdAt: 0,
  updatedAt: 0,
  data: { text: "hello world" },
};

describe("NoteCard", () => {
  it("renders the note text", () => {
    render(<NoteCard node={note} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });
});
