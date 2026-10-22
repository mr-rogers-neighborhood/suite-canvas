import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { MentionChip, MentionChipNodeView } from "./MentionChip";

const mocks = vi.hoisted(() => ({
  card: vi.fn(),
  title: vi.fn(),
}));

vi.mock("../store/workspaceStore", () => ({
  useCard: (cardId: string) => mocks.card(cardId),
}));

vi.mock("../hooks/useCardContainers", () => ({
  useCardTitle: (cardId: string) => mocks.title(cardId),
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

    expect(openInspector).toHaveBeenCalledWith("card-1");
    expect(useUiStore.getState().inspectorNodeId).toBe("card-1");
  });

  it("should render unavailable for a missing card", () => {
    mocks.card.mockReturnValue(undefined);
    mocks.title.mockReturnValue("");
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

    render(<MentionChipNodeView {...nodeViewProps("card-1")} />);

    expect(screen.getByTestId("mention-chip")).toHaveTextContent("Unavailable card");
  });
});

describe("MentionChip", () => {
  it("should not take the caret when pressed", () => {
    const onOpen = vi.fn();
    render(<MentionChip cardId="card-1" title="Target" onOpen={onOpen} />);

    const chip = screen.getByTestId("mention-chip");
    expect(chip).toHaveAttribute("contenteditable", "false");
    fireEvent.pointerDown(chip);
    expect(chip).toBeInTheDocument();
  });
});
