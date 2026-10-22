import type { Card, CardFieldView, CardType, FieldDefinition } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import { BODY_PLACEHOLDER } from "./CardBodyEditor";
import { CardInspector } from "./CardInspector";
import {
  type CardLinks,
  CardPanel,
  type CardPanelProps,
  type CardWhere,
  cardLinks,
  EMPTY_CARD_LINKS,
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
  links: EMPTY_CARD_LINKS,
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
  onOpenCardPanel: () => {},
  onManageTypes: () => {},
  onFocusCard: () => {},
  onFocusSection: () => {},
  onRemoveFromBoard: () => {},
  onFocusLink: () => {},
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
    const { container } = renderPanel({ onStartEditing, bodyEmpty: true });

    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
    fireEvent.click(screen.getByTestId("card-panel-body"));

    expect(onStartEditing).toHaveBeenCalledWith("body");
  });

  it("keeps the body read-only while the title owns the surface", () => {
    const { container } = renderPanel({ editing: "title", bodyEmpty: true });

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
      bodyEmpty: true,
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
          labelDrag: null,
        },
      ],
    });

    expect(screen.getByTestId("peer-name-tag")).toHaveTextContent("Nova");
  });
});

const populated: CardLinks = {
  // Hosts hand rows over sorted by title, like `cardLinks` does.
  incoming: [
    {
      cardId: "n3",
      title: "Interview notes",
      glyph: "\u25a1",
      occurrences: [{ key: "in:n3:mention::0", kind: "mention", boardId: null }],
      kinds: ["mention"],
      mutual: false,
      boardId: null,
    },
    {
      cardId: "n2",
      title: "Onboarding friction",
      glyph: "P",
      occurrences: [
        {
          key: "in:n2:mention:\u2026pair this with Onboarding friction\u2026:0",
          kind: "mention",
          detail: "\u2026pair this with Onboarding friction\u2026",
          boardId: "board-2",
          boardName: "Drafts",
        },
      ],
      kinds: ["mention"],
      mutual: true,
      boardId: "board-2",
      boardName: "Drafts",
    },
    {
      cardId: "n5",
      title: "Pricing memo",
      glyph: "P",
      occurrences: [
        {
          key: "in:n5:property:Contradicts:0",
          kind: "property",
          detail: "Contradicts",
          boardId: "board-1",
          boardName: "Research",
        },
        {
          key: "in:n5:arrow:supersedes pricing:1",
          kind: "arrow",
          detail: "supersedes pricing",
          boardId: "board-1",
          boardName: "Research",
        },
      ],
      kinds: ["property", "arrow"],
      relationship: "Contradicts",
      mutual: false,
      boardId: "board-1",
      boardName: "Research",
    },
  ],
  outgoing: [
    {
      cardId: "n4",
      title: "Retention spike",
      glyph: "\u25a1",
      occurrences: [
        {
          key: "out:n4:mention::0",
          kind: "mention",
          boardId: "board-1",
          boardName: "Research",
        },
      ],
      kinds: ["mention"],
      mutual: false,
      boardId: "board-1",
      boardName: "Research",
    },
  ],
};

/** The row itself is a list item; its first button is the navigation target. */
function rowButton(row: HTMLElement): HTMLElement {
  const button = row.querySelector("button");
  if (!button) throw new Error("row has no navigation button");
  return button;
}

describe("CardPanel tabs", () => {
  it("opens an empty card on Content", () => {
    renderPanel({ bodyEmpty: true });

    expect(screen.getByTestId("card-panel-tab-content")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("card-panel-body")).toBeInTheDocument();
    expect(screen.queryByTestId("property-owner")).not.toBeInTheDocument();
  });

  it("opens a card with content on Details", () => {
    renderPanel();

    expect(screen.getByTestId("card-panel-tab-details")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("property-owner")).toBeInTheDocument();
    expect(screen.queryByTestId("card-panel-body")).not.toBeInTheDocument();
  });

  it("switches tabs and ends a body edit when Details hides the editor", () => {
    const onEditEnd = vi.fn();
    renderPanel({ editing: "body", onEditEnd });

    // Editing the body from anywhere lands on Content.
    expect(screen.getByTestId("card-panel-tab-content")).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByTestId("card-panel-tab-details"));

    expect(onEditEnd).toHaveBeenCalled();
    expect(screen.getByTestId("card-panel-tab-details")).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("card-panel-body")).not.toBeInTheDocument();
    expect(screen.getByTestId("property-owner")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("card-panel-tab-content"));

    expect(screen.getByTestId("card-panel-body")).toBeInTheDocument();
    expect(screen.queryByTestId("property-owner")).not.toBeInTheDocument();
  });

  it("opens on Details when it was asked to reveal a field", () => {
    renderPanel({ bodyEmpty: true, focusedField: "owner" });

    expect(screen.getByTestId("card-panel-tab-details")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Owner")).toHaveFocus();
  });

  it("switches to Details when the panel is asked to reveal a field", () => {
    const { rerender } = renderPanel({ bodyEmpty: true });
    expect(screen.getByTestId("card-panel-tab-content")).toHaveAttribute("aria-selected", "true");

    rerender(<CardPanel {...base} bodyEmpty focusedField="owner" />);

    expect(screen.getByTestId("card-panel-tab-details")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("property-owner")).toHaveAttribute("data-focused", "true");
    expect(screen.getByLabelText("Owner")).toHaveFocus();
  });

  it("writes the placeholder onto the empty paragraph without content", () => {
    const { container } = renderPanel({ bodyEmpty: true });

    const paragraph = bodyEditor(container).querySelector("p");
    expect(paragraph).toHaveAttribute("data-placeholder", BODY_PLACEHOLDER);
    expect(paragraph).toHaveClass("is-editor-empty");
    expect(paragraph?.textContent).toBe("");
  });
});

describe("CardPanel links", () => {
  it("renders both directions and navigates its rows", () => {
    const onFocusLink = vi.fn();
    renderPanel({ links: populated, onFocusLink });

    expect(screen.getByTestId("card-links")).toBeInTheDocument();
    expect(screen.queryByTestId("links-empty")).not.toBeInTheDocument();

    const incoming = screen.getAllByTestId("link-row");
    expect(incoming).toHaveLength(4);
    const [unplaced, snippet, multi, outgoing] = incoming;
    if (!unplaced || !snippet || !multi || !outgoing) throw new Error("link rows missing");

    expect(unplaced).toHaveTextContent("Interview notes");
    fireEvent.click(rowButton(unplaced));
    expect(onFocusLink).toHaveBeenLastCalledWith("n3", null);

    expect(snippet).toHaveTextContent("Onboarding friction");
    expect(snippet).toHaveTextContent("pair this with Onboarding friction");
    // Mentioned both ways, so the row carries the mutual marker.
    expect(snippet.querySelector('[data-testid="link-markers"]')).toHaveTextContent("\u270e\u2194");
    fireEvent.click(rowButton(snippet));
    expect(onFocusLink).toHaveBeenLastCalledWith("n2", "board-2");

    expect(multi).toHaveTextContent("Pricing memo");
    expect(multi).toHaveTextContent("Contradicts \u00b7 Research");
    expect(multi.querySelector('[data-testid="link-markers"]')).toHaveTextContent("\u25a4\u2197");

    // Two occurrences expand into a list that names each of them.
    const toggle = multi.querySelector('[data-testid="link-occurrences-toggle"]');
    if (!toggle) throw new Error("occurrence toggle missing");
    expect(multi.querySelector('[data-testid="link-occurrences"]')).toBeNull();
    fireEvent.click(toggle);
    const occurrences = multi.querySelectorAll('[data-testid="link-occurrence"]');
    expect([...occurrences].map((node) => node.getAttribute("data-kind"))).toEqual([
      "property",
      "arrow",
    ]);
    expect([...occurrences].map((node) => node.textContent)).toEqual([
      "\u25a4ContradictsResearch",
      "\u2197supersedes pricingResearch",
    ]);
    fireEvent.click(rowButton(multi));
    expect(onFocusLink).toHaveBeenLastCalledWith("n5", "board-1");

    expect(outgoing).toHaveTextContent("Retention spike");
    fireEvent.click(rowButton(outgoing));
    expect(onFocusLink).toHaveBeenLastCalledWith("n4", "board-1");
  });

  it("hides a direction that has no rows", () => {
    renderPanel({ links: { ...populated, outgoing: [] } });

    expect(screen.getByTestId("links-in")).toBeInTheDocument();
    expect(screen.queryByTestId("links-out")).not.toBeInTheDocument();
    expect(screen.queryByTestId("links-empty")).not.toBeInTheDocument();
  });

  it("shows the empty state only when both directions are empty", () => {
    renderPanel();

    expect(screen.getByTestId("card-links")).toBeInTheDocument();
    expect(screen.getByTestId("links-empty")).toHaveTextContent(
      "No links yet. Type @ in a card, or draw an arrow between two cards.",
    );
    expect(screen.queryByTestId("links-in")).not.toBeInTheDocument();
    expect(screen.queryByTestId("links-out")).not.toBeInTheDocument();
  });

  it("reveals and focuses the field a link asked for", () => {
    renderPanel({ focusedField: "owner" });

    const row = screen.getByTestId("property-owner");
    expect(row).toHaveAttribute("data-focused", "true");
    expect(screen.getByLabelText("Owner")).toHaveFocus();
  });

  it("marks no row when no field was asked for", () => {
    renderPanel();

    expect(screen.getByTestId("property-owner")).not.toHaveAttribute("data-focused");
  });

  it("offers other cards for a card field, never itself", () => {
    renderPanel({
      fields: [
        { typeId: "project", field: { ...owner, id: "related", name: "Related", kind: "card" } },
      ],
    });

    fireEvent.focus(screen.getByLabelText("Related"));
    expect(screen.getAllByTestId("card-option").map((option) => option.textContent)).toEqual([
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

describe("cardLinks", () => {
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

  it("groups mentions, properties and arrows by the other card", () => {
    const rows = cardLinks(input);

    expect(rows.incoming.map((row) => row.cardId)).toEqual(["n2", "n3", "n4"]);
    expect(rows.outgoing.map((row) => row.cardId)).toEqual(["n4"]);

    const [mention, property, arrow] = rows.incoming;
    expect(mention).toMatchObject({
      title: "Title n2",
      boardId: "board-1",
      boardName: "Research",
      glyph: "P",
      kinds: ["mention"],
      mutual: false,
    });
    expect(property).toMatchObject({
      cardId: "n3",
      boardId: null,
      kinds: ["property"],
      relationship: "Related",
    });
    expect(arrow).toMatchObject({ cardId: "n4", kinds: ["arrow"], boardId: "board-2" });
    expect(arrow?.occurrences[0]?.detail).toBe("blocks the launch");
  });

  it("marks a pair that links both ways", () => {
    const rows = cardLinks(input);

    // n1 mentions n4 and an arrow runs from n4 to n1: one pair, both directions.
    expect(rows.outgoing[0]?.mutual).toBe(true);
    expect(rows.incoming.find((row) => row.cardId === "n4")?.mutual).toBe(true);
    expect(rows.incoming.find((row) => row.cardId === "n2")?.mutual).toBe(false);
  });

  it("attaches the snippet the host provides and omits it otherwise", () => {
    const withSnippet = cardLinks({
      ...input,
      mentionSnippet: (source, mentioned) => `${source} mentions ${mentioned}`,
    });
    expect(withSnippet.incoming[0]?.occurrences[0]?.detail).toBe("n2 mentions n1");

    const withoutSnippet = cardLinks({ ...input, mentionSnippet: () => undefined });
    expect(withoutSnippet.incoming[0]?.occurrences[0]?.detail).toBeUndefined();
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

describe("CardPanel read-only (share viewer)", () => {
  const links: CardLinks = {
    incoming: [],
    outgoing: [
      {
        cardId: "n2",
        title: "Onboarding friction",
        glyph: "\u25a1",
        occurrences: [{ key: "n2:mention", kind: "mention", boardId: null }],
        kinds: ["mention"],
        mutual: false,
        boardId: null,
      },
      {
        cardId: "n3",
        title: "Private card",
        glyph: "\u25a1",
        occurrences: [{ key: "n3:mention", kind: "mention", boardId: null }],
        kinds: ["mention"],
        mutual: false,
        boardId: null,
      },
    ],
  };

  it("renders without edit affordances or the empty-body placeholder", () => {
    const onStartEditing = vi.fn();
    const onRemoveFromBoard = vi.fn();
    const { container } = renderPanel({
      readOnly: true,
      bodyEmpty: true,
      onStartEditing,
      onRemoveFromBoard,
    });

    expect(screen.queryByTestId("manage-types")).toBeNull();
    expect(screen.queryByTestId("inspector-edit")).toBeNull();
    expect(screen.queryByText("Remove")).toBeNull();
    expect(container.querySelector('[data-testid="property-owner"] input')).toBeNull();
    expect(bodyEditor(container)).toHaveAttribute("contenteditable", "false");
    // The viewer has no way to write, so the body must not invite typing. The
    // placeholder is a decoration on the empty paragraph, not body text.
    expect(container.querySelector(".node-card-editor p.is-editor-empty")).toBeNull();
    expect(container.textContent).not.toContain(BODY_PLACEHOLDER);

    fireEvent.click(screen.getByTestId("card-panel-title"));
    fireEvent.click(screen.getByTestId("card-panel-body"));
    expect(onStartEditing).not.toHaveBeenCalled();
  });

  it("still advertises the placeholder to the owner", () => {
    const { container } = renderPanel({ bodyEmpty: true });
    expect(container.querySelector(".node-card-editor p.is-editor-empty")).toHaveAttribute(
      "data-placeholder",
      BODY_PLACEHOLDER,
    );
  });

  it("keeps navigation to shared cards but renders out-of-share rows inert", () => {
    const onFocusLink = vi.fn();
    renderPanel({ readOnly: true, links, onFocusLink });

    const inert = screen.getByTestId("link-row-inert");
    expect(inert.tagName).toBe("SPAN");
    expect(inert).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(inert);
    expect(onFocusLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("Onboarding friction"));
    expect(onFocusLink).toHaveBeenCalledWith("n2", null);
  });

  it("shows types, tags and property values as static text", () => {
    renderPanel({
      readOnly: true,
      tags: [
        { id: "tag-1", name: "alpha", createdAt: 0 },
        { id: "tag-2", name: "beta", createdAt: 0 },
      ],
      card: { ...card, tags: ["tag-1"], properties: { owner: "Ada" } },
    });

    expect(screen.getByTestId("type-view-project")).toHaveTextContent("Project");
    expect(screen.getByTestId("tag-list")).toHaveTextContent("#alpha");
    expect(screen.getByTestId("tag-list")).not.toHaveTextContent("#beta");
    expect(screen.getByTestId("property-value-owner")).toHaveTextContent("Ada");
  });
});
