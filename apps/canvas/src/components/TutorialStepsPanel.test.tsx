import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { beforeAll, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { TutorialStepsPanel } from "./TutorialStepsPanel";

const workspace = useCanvasStore.getState().workspace;
let boardId = "";
let sequence = 0;

beforeAll(() => {
  boardId = workspace.ensureBoard().id;
});

/** A title tree in the shape `loro-prosemirror` writes. */
function writeTitle(cardId: string, text: string): void {
  const title = workspace.getTitle(cardId);
  title.set("nodeName", "doc");
  const blocks = title.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap());
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  inline.insertContainer(0, new LoroText()).insert(0, text);
  workspace.doc.commit({ origin: "text:title" });
}

function card(title: string): { id: string } {
  sequence += 1;
  const created = workspace.createCard({
    id: `steps-panel-${sequence}`,
    boardId,
    position: { x: sequence * 40, y: 0 },
  });
  writeTitle(created.id, title);
  return { id: created.id };
}

/** The panel plus the one canvas card its picker may click. */
function renderPanel(cardId: string, targetId: string) {
  return render(
    <div>
      <div data-node-id={targetId} data-testid="fake-canvas-card" />
      <TutorialStepsPanel
        cardId={cardId}
        cardDoc={workspace.doc}
        contentId={workspace.contentId(cardId)}
      />
    </div>,
  );
}

async function addStep(cardId: string, targetId: string) {
  renderPanel(cardId, targetId);
  fireEvent.click(screen.getByTestId("tutorial-add-step"));
  fireEvent.click(screen.getByTestId("fake-canvas-card"));
  await waitFor(() => expect(screen.getByTestId("tutorial-step-count").textContent).toBe("1 step"));
}

describe("tutorial steps panel", () => {
  it("should say a tour has no steps, then add one from a canvas click", async () => {
    const tour = card("Tour");
    const target = card("Target card");
    await addStep(tour.id, target.id);

    // The row reads the target's title, not its id.
    expect(screen.getByTestId("tutorial-step-row").textContent).toContain("Target card");
    expect(screen.getByTestId("tutorial-present").hasAttribute("disabled")).toBe(false);
  });

  it("should remove a step from its row and leave an empty tour", async () => {
    const tour = card("Tour to empty");
    const target = card("Empty target");
    await addStep(tour.id, target.id);

    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
    await waitFor(() => expect(screen.getByTestId("tutorial-steps-empty")).toBeTruthy());
    expect(screen.getByTestId("tutorial-step-count").textContent).toBe("0 steps");
  });

  it("should present the tour from its first step", async () => {
    const tour = card("Tour to play");
    const target = card("Play target");
    await addStep(tour.id, target.id);

    fireEvent.click(screen.getByTestId("tutorial-present"));
    expect(useUiStore.getState().tour).toMatchObject({
      tutorialId: tour.id,
      stepIndex: 0,
      presenting: true,
    });
    useUiStore.getState().closeTour();
  });
});
