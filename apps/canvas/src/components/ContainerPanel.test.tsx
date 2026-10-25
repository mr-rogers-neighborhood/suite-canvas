import { sectionForCard, type Tag, WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContainerPanel } from "./ContainerPanel";
import type { ContainerPanelModel } from "./useContainerPanelModel";

/**
 * The container panel edits the labels of the thing it shows: a section's own
 * tags, or the tags of the board a portal opens (ADR-0053 §6). A tag is a label,
 * never a membership rule, so these tests also pin down that tagging leaves the
 * derived section membership exactly as geometry left it.
 */

const noop = () => {};

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.createBoard({ name: "Home" });
  const opened = workspace.createBoard({ name: "Opened" });
  const section = workspace.createSection({
    boardId: board.id,
    title: "Act one",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
  });
  const card = workspace.createCard({ boardId: board.id, position: { x: 40, y: 40 } });
  const tag = workspace.createTag({ name: "research" });
  return { workspace, board, opened, section, card, tag };
}

function sectionModel(
  workspace: WorkspaceDocument,
  sectionId: string,
  overrides: Partial<ContainerPanelModel> = {},
): ContainerPanelModel {
  const section = workspace.getSection(sectionId);
  if (!section) throw new Error("section is missing");
  return {
    kind: "section",
    id: section.id,
    title: section.title,
    board: null,
    section,
    color: section.color ?? null,
    members: [],
    links: [],
    contents: [],
    boardOptions: [],
    targetBoardId: null,
    boardId: section.boardId,
    readOnly: false,
    canEditLayout: true,
    orphan: false,
    ...overrides,
  };
}

function portalModel(
  workspace: WorkspaceDocument,
  boardId: string,
  overrides: Partial<ContainerPanelModel> = {},
): ContainerPanelModel {
  const board = workspace.getBoard(boardId);
  if (!board) throw new Error("board is missing");
  return {
    kind: "portal",
    id: "portal-1",
    title: board.name,
    board,
    section: null,
    color: board.color ?? null,
    members: [],
    links: [],
    contents: [],
    boardOptions: [],
    targetBoardId: board.id,
    boardId,
    readOnly: false,
    canEditLayout: true,
    orphan: false,
    ...overrides,
  };
}

function renderPanel(model: ContainerPanelModel, workspace: WorkspaceDocument) {
  const tags: Tag[] = workspace.listTags();
  return render(
    <ContainerPanel
      model={model}
      onClose={noop}
      onLocate={noop}
      onSetColor={noop}
      workspace={workspace}
      tags={tags}
    />,
  );
}

/** TagPicker commits a typed name on Enter, so this is the whole gesture. */
function typeTag(name: string) {
  const input = screen.getByTestId("tag-input");
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("ContainerPanel tags", () => {
  it("tags a section without moving a card into or out of it", () => {
    const { workspace, board, section, card, tag } = setup();
    const membership = () =>
      sectionForCard(
        workspace.getPlacement(board.id, card.id) ?? { x: 0, y: 0 },
        workspace.listSections(),
      )?.id;

    expect(membership()).toBe(section.id);

    renderPanel(sectionModel(workspace, section.id), workspace);
    typeTag("research");

    expect(workspace.getSection(section.id)?.tags).toEqual([tag.id]);
    // The tag changed the label and nothing else: the card is still inside.
    expect(membership()).toBe(section.id);

    // Moving the card out leaves the tag where it was: it never held the card.
    workspace.updatePlacementPosition(board.id, card.id, { x: 5000, y: 5000 });

    expect(membership()).toBeUndefined();
    expect(workspace.getSection(section.id)?.tags).toEqual([tag.id]);
  });

  it("removes a section tag from the record", () => {
    const { workspace, section, tag } = setup();
    workspace.addSectionTag(section.id, tag.id);

    renderPanel(sectionModel(workspace, section.id), workspace);
    expect(screen.getByTestId("tag-chip")).toHaveTextContent("#research");

    fireEvent.click(screen.getByLabelText("Remove tag research"));

    expect(workspace.getSection(section.id)?.tags).toEqual([]);
  });

  it("tags the board a portal opens", () => {
    const { workspace, opened, tag } = setup();

    renderPanel(portalModel(workspace, opened.id), workspace);
    expect(screen.getByTestId("container-tags")).toHaveAttribute("data-target", "board");
    typeTag("research");

    expect(workspace.getBoard(opened.id)?.tags).toEqual([tag.id]);
  });

  it("creates a missing tag and assigns it", () => {
    const { workspace, section } = setup();

    renderPanel(sectionModel(workspace, section.id), workspace);
    typeTag("draft");

    const created = workspace.listTags().find((entry) => entry.name === "draft");
    expect(created).toBeDefined();
    expect(workspace.getSection(section.id)?.tags).toEqual([created?.id]);
  });

  it("reads tags as chips when the session cannot write", () => {
    const { workspace, section, tag } = setup();
    workspace.addSectionTag(section.id, tag.id);

    renderPanel(sectionModel(workspace, section.id, { readOnly: true }), workspace);

    expect(screen.getByTestId("container-tag-chip")).toHaveTextContent("#research");
    expect(screen.queryByTestId("tag-input")).toBeNull();
  });
});
