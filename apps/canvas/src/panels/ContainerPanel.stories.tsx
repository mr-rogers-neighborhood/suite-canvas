import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceDocument } from "@suite/graph";
import { LoroMap, LoroText } from "loro-crdt";
import { ContainerPanel } from "./ContainerPanel";
import type { ContainerPanelModel } from "./useContainerPanelModel";

/**
 * A plain document fixture, the same shape the panel gets from the board: the
 * section's own record, its members and its links. No relay, no IndexedDB.
 */
function fixture() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.createBoard({ name: "Research" });
  const opened = workspace.createBoard({ name: "Act two" });
  const section = workspace.createSection({
    boardId: board.id,
    title: "Act one",
    x: 0,
    y: 0,
    width: 600,
    height: 400,
  });
  const card = workspace.createCard({ boardId: board.id, position: { x: 40, y: 40 } });
  const children = workspace.getContent(card.id).ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  const text = paragraph.ensureMergeableList("children").insertContainer(0, new LoroText());
  text.insert(0, "The first act sets the pace.");
  workspace.doc.commit({ origin: "story" });
  return { workspace, board, opened, section, card };
}

const { workspace, board, opened, section, card } = fixture();

function sectionModel(overrides: Partial<ContainerPanelModel> = {}): ContainerPanelModel {
  return {
    kind: "section",
    id: section.id,
    title: section.title,
    board: null,
    section: workspace.getSection(section.id) ?? null,
    icon: null,
    color: section.color ?? null,
    members: [{ id: card.id, title: workspace.displayTitle(card.id) }],
    links: [],
    contents: [],
    boardOptions: [],
    targetBoardId: null,
    boardId: board.id,
    readOnly: false,
    canEditLayout: true,
    orphan: false,
    ...overrides,
  };
}

function portalModel(overrides: Partial<ContainerPanelModel> = {}): ContainerPanelModel {
  const portal = workspace.createPortalCard({ boardId: board.id, targetBoardId: opened.id });
  return {
    kind: "portal",
    id: portal.id,
    title: "Act two",
    board: workspace.getBoard(opened.id) ?? null,
    section: null,
    icon: null,
    color: null,
    members: [],
    links: [],
    contents: [
      {
        sectionId: opened.id,
        title: "Act two",
        cards: [{ id: card.id, title: workspace.displayTitle(card.id) }],
      },
    ],
    boardOptions: [],
    targetBoardId: opened.id,
    boardId: board.id,
    readOnly: false,
    canEditLayout: true,
    orphan: false,
    ...overrides,
  };
}

const meta = {
  title: "Components/ContainerPanel",
  component: ContainerPanel,
  parameters: { layout: "centered" },
  args: {
    onClose: () => {},
    onLocate: () => {},
    onSetColor: () => {},
    workspace,
  },
  decorators: [
    (Story) => (
      <div style={{ height: 520, width: 344 }}>
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof ContainerPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Section: Story = { args: { model: sectionModel() } };

export const Portal: Story = { args: { model: portalModel() } };

export const ReadOnly: Story = {
  args: { model: sectionModel({ readOnly: true, canEditLayout: false }) },
};

export const OrphanedPortal: Story = {
  args: {
    model: portalModel({
      board: null,
      orphan: true,
      contents: [],
      boardOptions: [{ id: opened.id, name: "Act two" }],
    }),
  },
};
