import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { MentionChip, MentionChipNodeView } from "./MentionChip";

const mocks = vi.hoisted(() => ({
  card: vi.fn(),
  title: vi.fn(),
  presence: vi.fn(),
}));

vi.mock("../store/workspaceStore", () => ({
  useCard: (cardId: string) => mocks.card(cardId),
  // Only a `@card.field` chip reads types; a plain mention never subscribes.
  // One stable object: a fresh snapshot per call would re-render forever.
  useWorkspaceStore: () => {
    const snapshot = { types: [] };
    return { getSnapshot: () => snapshot, subscribe: () => () => undefined };
  },
}));

vi.mock("../hooks/useCardContainers", () => ({
  useCardTitle: (cardId: string) => mocks.title(cardId),
  useCardPresence: (cardId: string) => mocks.presence(cardId) ?? "card",
}));

const card = {
  id: "card-1",
  createdAt: 0,
  updatedAt: 0,
  connectors: [],
  deletedAt: null,
  typeIds: ["note"],
  primaryTypeId: "note",
  tags: [],
  properties: {},
};

function nodeViewProps(cardId: string) {
  return { node: { attrs: { cardId } } } as unknown as Parameters<typeof MentionChipNodeView>[0];
}

afterEach(() => {
  vi.restoreAllMocks();
  mocks.card.mockReset();
  mocks.title.mockReset();
  mocks.presence.mockReset();
  useUiStore.setState({ inspectorNodeId: null });
});

describe("MentionChipNodeView", () => {
  it("should render the target's live title", () => {
    mocks.card.mockReturnValue(card);
    mocks.title.mockReturnValue("Onboarding friction");

    render(<MentionChipNodeView {...nodeViewProps("card-1")} />);

    expect(screen.getByTestId("mention-chip")).toHaveTextContent("Onboarding friction");
    expect(screen.getByTestId("mention-chip")).not.toHaveAttribute("data-unavailable");
    expect(mocks.title).toHaveBeenCalledWith("card-1");
  });

  it("should open the target's panel on click", () => {
    mocks.card.mockReturnValue(card);
    mocks.title.mockReturnValue("Onboarding friction");
    const openInspector = vi.spyOn(useUiStore.getState(), "openInspector");

    render(<MentionChipNodeView {...nodeViewProps("card-1")} />);
    fireEvent.click(screen.getByTestId("mention-chip"));

    expect(openInspector).toHaveBeenCalledWith("card-1", null);
    expect(useUiStore.getState().inspectorNodeId).toBe("card-1");
  });

  it("should render unavailable for a missing card", () => {
    mocks.card.mockReturnValue(undefined);
    mocks.title.mockReturnValue("");
    mocks.presence.mockReturnValue("missing");
    const openInspector = vi.spyOn(useUiStore.getState(), "openInspector");

    render(<MentionChipNodeView {...nodeViewProps("gone")} />);
    fireEvent.click(screen.getByTestId("mention-chip"));

    expect(screen.getByTestId("mention-chip")).toHaveTextContent("Unavailable card");
    expect(screen.getByTestId("mention-chip")).toHaveAttribute("data-unavailable", "true");
    expect(openInspector).not.toHaveBeenCalled();
  });

  it("should render unavailable for a trashed card", () => {
    mocks.card.mockReturnValue({ ...card, deletedAt: 1700000000000 });
    mocks.title.mockReturnValue("Onboarding friction");
    mocks.presence.mockReturnValue("card");

    render(<MentionChipNodeView {...nodeViewProps("card-1")} />);

    expect(screen.getByTestId("mention-chip")).toHaveTextContent("Unavailable card");
  });

  it("should render a referenced-but-unshared stub as inert, not deleted", () => {
    mocks.card.mockReturnValue(undefined);
    mocks.title.mockReturnValue("Private card");
    mocks.presence.mockReturnValue("stub");
    const openInspector = vi.spyOn(useUiStore.getState(), "openInspector");

    render(<MentionChipNodeView {...nodeViewProps("private-1")} />);
    const chip = screen.getByTestId("mention-chip");
    fireEvent.click(chip);

    expect(chip).toHaveTextContent("Private card");
    expect(chip).toHaveTextContent("not shared");
    expect(chip).toHaveAttribute("data-not-shared", "true");
    expect(chip).not.toHaveAttribute("data-unavailable");
    expect(chip).toHaveAttribute("aria-label", "Private card \u2014 not shared");
    expect(openInspector).not.toHaveBeenCalled();
  });
});

describe("MentionChip", () => {
  it("should render the value through its template", () => {
    render(
      <MentionChip
        cardId="card-1"
        title="Beta"
        field={{
          id: "owner",
          name: "Owner",
          value: "Ada",
          template: "{{card}}: {{value}}",
          fieldTemplate: "{{label}} \u00b7 {{value}}",
          typeName: "Note",
          overridden: true,
        }}
      />,
    );

    const chip = screen.getByTestId("mention-chip");
    expect(chip).toHaveTextContent("Beta: Ada");
    expect(chip).toHaveAttribute("data-overridden", "true");
    // The label token is gone from this template, so its text is not there either.
    expect(chip).not.toHaveTextContent("Owner");
  });

  it("should show a placeholder for an empty value", () => {
    render(
      <MentionChip
        cardId="card-1"
        title="Beta"
        field={{
          id: "owner",
          name: "Owner",
          value: "",
          template: "{{label}}: {{value}}",
          fieldTemplate: "{{label}} \u00b7 {{value}}",
          typeName: "Note",
          overridden: false,
        }}
      />,
    );

    expect(screen.getByTestId("mention-chip-value")).toHaveTextContent("\u2014");
  });

  it("should read as a field and open that field", () => {
    const onOpen = vi.fn();
    render(
      <MentionChip
        cardId="card-1"
        title="Beta"
        field={{
          id: "owner",
          name: "Owner",
          value: "Ada",
          template: "{{label}} \u00b7 {{value}}",
          fieldTemplate: "{{label}} \u00b7 {{value}}",
          typeName: "Note",
          overridden: false,
        }}
        onOpen={onOpen}
      />,
    );

    const chip = screen.getByTestId("mention-chip");
    expect(chip).toHaveTextContent("Owner");
    expect(chip).toHaveTextContent("Ada");
    expect(chip).toHaveAttribute("data-field-id", "owner");

    // A field chip opens its menu first: opening the card is one row inside.
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open card" }));
    expect(onOpen).toHaveBeenCalledWith("card-1", "owner");
  });

  it("should render three distinct states", () => {
    const { rerender } = render(<MentionChip cardId="card-1" title="Onboarding" />);

    let chip = screen.getByTestId("mention-chip");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).not.toHaveAttribute("data-not-shared");
    expect(chip).not.toHaveAttribute("data-unavailable");

    rerender(<MentionChip cardId="card-1" title="Private card" presence="stub" />);
    chip = screen.getByTestId("mention-chip");
    expect(chip.tagName).toBe("SPAN");
    expect(chip).toHaveAttribute("data-not-shared", "true");
    expect(chip).not.toHaveAttribute("data-unavailable");

    rerender(<MentionChip cardId="card-1" title="Onboarding" presence="missing" />);
    chip = screen.getByTestId("mention-chip");
    expect(chip).toHaveAttribute("data-unavailable", "true");
    expect(chip).not.toHaveAttribute("data-not-shared");
    expect(chip).toHaveTextContent("Unavailable card");
  });

  it("should not open an unshared card", () => {
    const onOpen = vi.fn();
    render(<MentionChip cardId="card-1" title="Private card" presence="stub" onOpen={onOpen} />);

    const chip = screen.getByTestId("mention-chip");
    fireEvent.click(chip);
    fireEvent.contextMenu(chip);
    fireEvent.pointerDown(chip);

    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("should not take the caret when pressed", () => {
    const onOpen = vi.fn();
    render(<MentionChip cardId="card-1" title="Target" onOpen={onOpen} />);

    const chip = screen.getByTestId("mention-chip");
    expect(chip).toHaveAttribute("contenteditable", "false");
    fireEvent.pointerDown(chip);
    expect(chip).toBeInTheDocument();
  });
});
