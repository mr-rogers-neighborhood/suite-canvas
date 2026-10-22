import type { Card, CardFieldView, CardType, FieldDefinition } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import { CardInspector } from "./CardInspector";
import {
  CardPanel,
  type CardPanelProps,
  type CardReferences,
  type CardWhere,
  cardReferences,
  EMPTY_CARD_REFERENCES,
  snippetAround,
} from "./CardPanel";

const doc = new LoroDoc();
const contentId = doc.getMap("content").ensureMergeableMap("n1").id;
const titleId = doc.getMap("titles").ensureMergeableMap("n1").id;

const owner: FieldDefinition = {
  id: "owner",
  name: "Owner",
  kind: "text",
  required: false,
  order: 0,
  options: [],
};

const type: CardType = {
  id: "project",
  name: "Project",
  glyph: "P",
  createdAt: 0,
  updatedAt: 0,
  fields: [owner],
};

const card: Card = {
  id: "n1",
  createdAt: 0,
  updatedAt: 0,
  connectors: [],
  deletedAt: null,
  typeIds: ["project"],
  primaryTypeId: "project",
  tags: [],
  properties: {},
};

const fields: CardFieldView[] = [{ typeId: "project", field: owner }];

const where: CardWhere = {
  unplaced: false,
  entries: [
    {
      boardId: "board-1",
      boardName: "Research",
      isHome: true,
      isCurrent: true,
      sectionPath: [
        { id: "section-1", name: "Timelines" },
        { id: "section-2", name: "Drafts", color: "var(--section-blue)" },
      ],
    },
    {
      boardId: "board-2",
      boardName: "Drafts",
      isHome: false,
      isCurrent: false,
      sectionPath: [],
    },
  ],
};

const base: CardPanelProps = {
  card,
  title: "Mastering the timeline",
  types: [type],
  tags: [],
  fields,
  where,
  cards: [
    { id: "n1", title: "Mastering the timeline" },
    { id: "n2", title: "Onboarding friction" },
  ],
  references: EMPTY_CARD_REFERENCES,
  editing: null,
  cardDoc: doc,
  contentId,
  titleId,
  cursorStore: null,
  localUser: null,
  peers: [],
  onStartEditing: () => {},
  onEditEnd: () => {},
  onSetType: () => {},
  onAddTag: () => {},
  onRemoveTag: () => {},
  onCreateTag: () => {},
  onSetProperty: () => {},
  onClearProperty: () => {},
  bodyFields: [],
  onShowInBody: () => {},
  onHideFromBody: () => {},
  onOpenCardPanel: () => {},
  onManageTypes: () => {},
  onFocusCard: () => {},
  onFocusSection: () => {},
  onRemoveFromBoard: () => {},
  onFocusReference: () => {},
  onFocusArrow: () => {},
};

function renderPanel(overrides: Partial<CardPanelProps> = {}) {
  return render(<CardPanel {...base} {...overrides} />);
}

function bodyEditor(container: HTMLElement): HTMLElement {
  const element = container.querySelector(".card-panel-body .node-card-editor");
  if (!element) throw new Error("body editor not mounted");
  return element as HTMLElement;
}

describe("CardPanel", () => {
  it("starts title editing when the read-only title is clicked", () => {
    const onStartEditing = vi.fn();
    renderPanel({ onStartEditing });

    fireEvent.click(screen.getByTestId("card-panel-title"));

    expect(onStartEditing).toHaveBeenCalledWith("title");
  });

  it("starts body editing when the read-only body is clicked", () => {
    const onStartEditing = vi.fn();
    const { container } = renderPanel({ onStartEditing });

    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
    fireEvent.click(screen.getByTestId("card-panel-body"));

    expect(onStartEditing).toHaveBeenCalledWith("body");
  });

  it("keeps the body read-only while the title owns the surface", () => {
    const { container } = renderPanel({ editing: "title" });

    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
    expect(container.querySelector(".card-title-editor")).toHaveAttribute(
      "contenteditable",
      "true",
    );
  });

  it("makes the body editable when the panel owns it", () => {
    const { container } = renderPanel({ editing: "body" });

    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "true");
  });

  it("commits a property edit on blur", () => {
    const onSetProperty = vi.fn();
    renderPanel({ onSetProperty });

    const input = screen.getByLabelText("Owner");
    fireEvent.change(input, { target: { value: "Ada Lovelace" } });
    fireEvent.blur(input);

    expect(onSetProperty).toHaveBeenCalledWith("owner", "Ada Lovelace");
  });

  it("commits the title on Enter", () => {
    const onEditEnd = vi.fn();
    const { container } = renderPanel({ editing: "title", onEditEnd });

    const title = container.querySelector(".card-title-editor");
    if (!title) throw new Error("title editor not mounted");
    fireEvent.keyDown(title, { key: "Enter" });

    expect(onEditEnd).toHaveBeenCalled();
  });

  it("renders the Where breadcrumbs and other boards", () => {
    const onFocusSection = vi.fn();
    const onFocusCard = vi.fn();
    renderPanel({ onFocusSection, onFocusCard });

    expect(screen.getByTestId("inspector-section")).toHaveTextContent("Drafts");
    fireEvent.click(screen.getByTestId("inspector-section"));
    expect(onFocusSection).toHaveBeenCalledWith("section-2");

    fireEvent.click(screen.getByRole("button", { name: "Research" }));
    expect(onFocusCard).toHaveBeenCalledWith("board-1");

    expect(screen.getByTestId("inspector-boards").querySelectorAll("li")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onFocusCard).toHaveBeenCalledWith("board-2");
  });

  it("shows the inbox state for an unplaced card", () => {
    renderPanel({ where: { unplaced: true, entries: [] } });

    expect(screen.getByTestId("card-where-empty")).toHaveTextContent("In the inbox");
    expect(screen.queryByTestId("inspector-boards")).not.toBeInTheDocument();
  });

  it("labels a peer editing the body", () => {
    renderPanel({
      peers: [
        {
          clientId: "peer-a",
          board: "board-1",
          user: { name: "Nova", color: "#f97316" },
          pointer: null,
          focus: { nodeId: "n1", field: "body" },
          dragging: null,
          selection: null,
          selectionBox: null,
          connector: null,
          resizing: null,
          sectionDrag: null,
          sectionResize: null,
          reconnect: null,
          connect: null,
        },
      ],
    });

    expect(screen.getByTestId("peer-name-tag")).toHaveTextContent("Nova");
  });
});

const populated: CardReferences = {
  // Hosts hand rows over sorted by title, like `cardReferences` does.
  incoming: [
    { key: "in:n3", cardId: "n3", title: "Interview notes", glyph: "\u25a1", boardId: null },
    {
      key: "in:n2",
      cardId: "n2",
      title: "Onboarding friction",
      glyph: "P",
      boardId: "board-2",
      boardName: "Drafts",
      snippet: "\u2026pair this with Onboarding friction\u2026",
    },
  ],
  outgoing: [
    {
      key: "out:n4",
      cardId: "n4",
      title: "Retention spike",
      glyph: "\u25a1",
      boardId: "board-1",
      boardName: "Research",
    },
  ],
  property: [
    {
      key: "field:n5:related",
      cardId: "n5",
      title: "Pricing memo",
      glyph: "P",
      boardId: "board-1",
      boardName: "Research",
      fieldName: "Contradicts",
    },
  ],
  arrows: [
    {
      key: "arrow:e1",
      edgeId: "e1",
      cardId: "n6",
      title: "Launch plan",
      glyph: "P",
      boardId: "board-2",
      boardName: "Drafts",
      description: "blocks the launch",
    },
  ],
};

describe("CardPanel references", () => {
  it("renders every group and navigates its rows", () => {
    const onFocusReference = vi.fn();
    const onFocusArrow = vi.fn();
    renderPanel({ references: populated, onFocusReference, onFocusArrow });

    expect(screen.getByTestId("card-references")).toBeInTheDocument();
    expect(screen.queryByTestId("references-empty")).not.toBeInTheDocument();

    const incoming = screen.getAllByTestId("reference-incoming");
    expect(incoming).toHaveLength(2);
    const [unplaced, placed] = incoming;
    if (!unplaced || !placed) throw new Error("incoming rows missing");
    expect(unplaced).toHaveTextContent("Interview notes");
    expect(unplaced).toHaveTextContent("In the inbox");
    expect(placed).toHaveTextContent("Onboarding friction");
    expect(placed).toHaveTextContent("pair this with Onboarding friction");

    fireEvent.click(placed);
    expect(onFocusReference).toHaveBeenLastCalledWith("n2", "board-2");
    fireEvent.click(unplaced);
    expect(onFocusReference).toHaveBeenLastCalledWith("n3", null);

    fireEvent.click(screen.getByTestId("reference-outgoing"));
    expect(onFocusReference).toHaveBeenLastCalledWith("n4", "board-1");

    const property = screen.getByTestId("reference-property");
    expect(property).toHaveTextContent("Contradicts");
    expect(property).toHaveTextContent("Pricing memo");
    fireEvent.click(property);
    expect(onFocusReference).toHaveBeenLastCalledWith("n5", "board-1");

    const arrow = screen.getByTestId("reference-arrow");
    expect(arrow).toHaveTextContent("Launch plan");
    expect(arrow).toHaveTextContent("blocks the launch");
    expect(arrow).toHaveTextContent("Drafts");
    fireEvent.click(arrow);
    expect(onFocusArrow).toHaveBeenLastCalledWith("n6", "board-2");
  });

  it("hides the groups that have no rows", () => {
    renderPanel({ references: { ...populated, property: [], arrows: [] } });

    expect(screen.getAllByTestId("reference-incoming")).toHaveLength(2);
    expect(screen.getByTestId("reference-outgoing")).toBeInTheDocument();
    expect(screen.queryByTestId("reference-property")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reference-arrow")).not.toBeInTheDocument();
    expect(screen.queryByTestId("references-empty")).not.toBeInTheDocument();
  });

  it("shows the empty state only when all four groups are empty", () => {
    renderPanel();

    expect(screen.getByTestId("card-references")).toBeInTheDocument();
    expect(screen.getByTestId("references-empty")).toHaveTextContent(
      "No references yet. Type @ in a card to link it.",
    );
    expect(screen.queryByTestId("reference-incoming")).not.toBeInTheDocument();
  });

  it("offers Show in body for a field without a block", () => {
    const onShowInBody = vi.fn();
    const onHideFromBody = vi.fn();
    renderPanel({ onShowInBody, onHideFromBody });

    const toggle = screen.getByTestId("body-toggle-owner");
    expect(toggle).toHaveTextContent("Show in body");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(onShowInBody).toHaveBeenCalledWith("owner");
    expect(onHideFromBody).not.toHaveBeenCalled();
  });

  it("offers Remove from body once the field has a block", () => {
    const onShowInBody = vi.fn();
    const onHideFromBody = vi.fn();
    renderPanel({ bodyFields: ["owner"], onShowInBody, onHideFromBody });

    const toggle = screen.getByTestId("body-toggle-owner");
    expect(toggle).toHaveTextContent("Remove from body");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(toggle);
    expect(onHideFromBody).toHaveBeenCalledWith("owner");
    expect(onShowInBody).not.toHaveBeenCalled();
  });

  it("includes the card picker options for a card field", () => {
    renderPanel({
      fields: [
        { typeId: "project", field: { ...owner, id: "related", name: "Related", kind: "card" } },
      ],
    });

    fireEvent.focus(screen.getByLabelText("Related"));
    expect(screen.getAllByTestId("card-option").map((option) => option.textContent)).toEqual([
      "Mastering the timeline",
      "Onboarding friction",
    ]);
  });
});

describe("CardInspector header count", () => {
  const inspectorBase = {
    ...base,
    onClose: () => {},
    onEdit: () => {},
  };

  it("shows the reference count next to the board count", () => {
    render(<CardInspector {...inspectorBase} linkCount={3} />);

    expect(screen.getByTestId("inspector-link-count")).toHaveTextContent("3");
  });

  it("hides the count when nothing references the card", () => {
    render(<CardInspector {...inspectorBase} linkCount={0} />);

    expect(screen.queryByTestId("inspector-link-count")).not.toBeInTheDocument();
  });
});

describe("cardReferences", () => {
  const projectType: CardType = {
    id: "project",
    name: "Project",
    glyph: "P",
    createdAt: 0,
    updatedAt: 0,
    fields: [
      { id: "related", name: "Related", kind: "card", required: false, order: 0, options: [] },
    ],
  };

  const makeCard = (id: string, properties: Card["properties"] = {}): Card => ({
    id,
    createdAt: 0,
    updatedAt: 0,
    connectors: [],
    deletedAt: null,
    typeIds: ["project"],
    primaryTypeId: "project",
    tags: [],
    properties,
  });

  const target = makeCard("n1");
  const mentioner = makeCard("n2");
  const proprietor = makeCard("n3", { related: "n1" });
  const drawnTo = makeCard("n4");

  const input = {
    cardId: "n1",
    references: { n2: ["n1"], n1: ["n4"] },
    cards: [target, mentioner, proprietor, drawnTo],
    types: [projectType],
    edges: [
      {
        id: "e1",
        boardId: "board-2",
        source: "n4",
        target: "n1",
        kind: "relates-to" as const,
        path: "bezier" as const,
        bidirectional: false,
        label: "blocks the launch",
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    placements: [
      { boardId: "board-1", cardId: "n2", x: 0, y: 0, z: 0, createdAt: 0 },
      { boardId: "board-2", cardId: "n4", x: 0, y: 0, z: 0, createdAt: 0 },
    ],
    boards: [
      { id: "board-1", name: "Research", createdAt: 0, updatedAt: 0 },
      { id: "board-2", name: "Drafts", createdAt: 0, updatedAt: 0 },
    ],
    displayTitle: (cardId: string) => `Title ${cardId}`,
  };

  it("unions mentions, properties and arrows, resolving placements", () => {
    const rows = cardReferences(input);

    expect(rows.incoming).toEqual([
      expect.objectContaining({ cardId: "n2", title: "Title n2", boardId: "board-1", glyph: "P" }),
    ]);
    expect(rows.outgoing).toEqual([
      expect.objectContaining({ cardId: "n4", boardId: "board-2", boardName: "Drafts" }),
    ]);
    expect(rows.property).toEqual([
      expect.objectContaining({ cardId: "n3", fieldName: "Related", boardId: null }),
    ]);
    expect(rows.arrows).toEqual([
      expect.objectContaining({
        edgeId: "e1",
        cardId: "n4",
        boardId: "board-2",
        boardName: "Drafts",
        description: "blocks the launch",
      }),
    ]);
  });

  it("attaches the snippet the host provides and omits it otherwise", () => {
    const withSnippet = cardReferences({
      ...input,
      mentionSnippet: (source, mentioned) => `${source} mentions ${mentioned}`,
    });
    expect(withSnippet.incoming[0]?.snippet).toBe("n2 mentions n1");

    const withoutSnippet = cardReferences({ ...input, mentionSnippet: () => undefined });
    expect(withoutSnippet.incoming[0]?.snippet).toBeUndefined();
  });

  it("trims body text around the target's title", () => {
    const text = `${"a".repeat(80)} Onboarding friction is the blocker ${"b".repeat(80)}`;
    const snippet = snippetAround(text, "onboarding friction", 10);

    expect(snippet).toContain("Onboarding friction");
    expect(snippet?.startsWith("\u2026")).toBe(true);
    expect(snippet?.endsWith("\u2026")).toBe(true);
    expect(snippetAround(text, "missing title")).toBeUndefined();
  });
});
