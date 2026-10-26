import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoroMap, LoroText } from "loro-crdt";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { BlueprintInstallHost } from "./BlueprintInstallHost";

/**
 * The blueprint install panel, opened from the palette row.
 *
 * Two things have to hold: the panel is reachable for the card the row named, and
 * pressing Install writes the type the card declares — in one undo step, because a
 * half-installed type is worse than none.
 */

/** One paragraph in a Loro body container, the shape the editor writes. */
function writeParagraph(container: LoroMap, value: string, nodeName = "paragraph"): void {
  const children = container.ensureMergeableList("children");
  const node = children.insertContainer(children.length, new LoroMap());
  node.set("nodeName", nodeName);
  node.ensureMergeableMap("attributes");
  node.ensureMergeableList("children").insertContainer(0, new LoroText()).insert(0, value);
}

/** A catalogue card: its title is the type's name, its body declares the fields. */
function catalogueCard(workspace: WorkspaceDocument): string {
  const board = workspace.ensureBoard();
  const card = workspace.createCard({ boardId: board.id, typeId: "note" });
  writeParagraph(workspace.getTitle(card.id), "Claim");
  const body = workspace.getContent(card.id);
  writeParagraph(body, "Say what the source claims.");
  writeParagraph(body, "Fields", "heading");
  const list = body.ensureMergeableList("children");
  const listNode = list.insertContainer(list.length, new LoroMap());
  listNode.set("nodeName", "bulletList");
  for (const line of ["Confidence: select", "Source: card"]) {
    const items = listNode.ensureMergeableList("children");
    const item = items.insertContainer(items.length, new LoroMap());
    item.set("nodeName", "listItem");
    writeParagraph(item, line);
  }
  workspace.doc.commit({ origin: "test" });
  return card.id;
}

beforeEach(() => {
  useUiStore.setState({ blueprintCardId: null });
});

describe("BlueprintInstallHost", () => {
  it("shows the plan for the card the palette named, and installs on one press", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const cardId = catalogueCard(workspace);
    useCanvasStore.setState({ workspace });
    useUiStore.setState({ blueprintCardId: cardId });

    render(<BlueprintInstallHost workspace={workspace} />);

    expect(screen.getByTestId("blueprint-install")).toBeInTheDocument();
    expect(screen.getByTestId("blueprint-field-Confidence")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("blueprint-install-button"));

    const type = workspace.listTypes().find((entry) => entry.name === "Claim");
    expect(type?.fields.map((field) => field.name)).toEqual(["Confidence", "Source"]);
    // The panel closes behind the write, and the store says it did.
    expect(useUiStore.getState().blueprintCardId).toBeNull();
    expect(screen.queryByTestId("blueprint-install-dialog")).toBeNull();
  });

  it("says why a card that declares no blueprint cannot install one", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    const card = workspace.createCard({ boardId: board.id, typeId: "note" });
    workspace.setTitleText(card.id, "Just a note");
    useCanvasStore.setState({ workspace });
    useUiStore.setState({ blueprintCardId: card.id });

    render(<BlueprintInstallHost workspace={workspace} />);

    expect(screen.queryByTestId("blueprint-install")).toBeNull();
    expect(screen.getByTestId("blueprint-install-reason")).toHaveTextContent(
      "declares no fields and no starter content",
    );
  });

  it("renders nothing until a card is named", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    useCanvasStore.setState({ workspace });

    render(<BlueprintInstallHost workspace={workspace} />);

    expect(screen.queryByTestId("blueprint-install-dialog")).toBeNull();
  });
});
