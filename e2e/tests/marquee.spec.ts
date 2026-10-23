import { expect, type Page, test } from "@playwright/test";
import {
  beginMarquee,
  cardByTitle,
  cards,
  clearSelection,
  dragCardTo,
  expectPageInteractive,
  finishMarquee,
  marqueeOver,
  type Point,
  paneStartBefore,
  seedGrid,
  selectedNodes,
  settleViewport,
  unionOf,
  watchErrors,
} from "./marquee";
import { withOwnerKey } from "./ownerUrl";

let sequence = 0;
/** A blank board: `blank=1` seeds nothing, so counts are exact. */
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?blank=1&workspace=e2e-marquee-${name}-${Date.now()}-${++sequence}`);

/**
 * Gate A10, §6.3: a marquee must never break the page.
 *
 * The report was "multi-select via marquee breaks the page as soon as any item
 * is selected or contacted". Each test below drives one shape of that gesture —
 * one card, two, many, across sections, with a peer moving things, and a
 * gesture cancelled mid-flight — and then proves the page is still alive rather
 * than only that a count matched.
 */

async function marqueeAround(
  page: Page,
  corners: { from: Point; to: Point },
  steps = 10,
): Promise<void> {
  await beginMarquee(page, corners.from, corners.to, steps);
  await finishMarquee(page);
}

test("selects one, two, and many cards without breaking the page", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(workspaceUrl("counts"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  const titles = [
    "Alpha",
    "Bravo",
    "Charlie",
    "Delta",
    "Echo",
    "Foxtrot",
    "Golf",
    "Hotel",
    "India",
    "Juliett",
  ];
  const boxes = await seedGrid(page, titles);

  // One card: a box over Alpha's top-left corner only.
  const first = boxes.get("Alpha");
  if (!first) throw new Error("Alpha was not seeded");
  await marqueeAround(page, {
    from: { x: first.x - 10, y: first.y - 10 },
    to: { x: first.x + 40, y: first.y + 30 },
  });
  await expect(selectedNodes(page)).toHaveCount(1);

  // Two cards: Alpha and Bravo share a row.
  await clearSelection(page);
  const bravo = boxes.get("Bravo");
  if (!bravo) throw new Error("Bravo was not seeded");
  const pair = unionOf([first, bravo]);
  await marqueeAround(page, {
    from: { x: pair.x - 10, y: pair.y - 10 },
    to: { x: pair.x + pair.width + 10, y: pair.y + pair.height + 10 },
  });
  await expect(selectedNodes(page)).toHaveCount(2);

  // Many cards: the whole board.
  await clearSelection(page);
  await marqueeOver(page, [...boxes.values()]);
  await expect(selectedNodes(page)).toHaveCount(titles.length);

  await expectPageInteractive(page, titles.length);
  expect(errors, "the marquee logged a console error").toEqual([]);
});

test("selects across two sections", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(workspaceUrl("sections"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  const titles = ["SectionA1", "SectionA2", "SectionB1", "SectionB2"];
  const boxes = await seedGrid(page, titles);

  // Control+G wraps the current selection in a section.
  const pairs = [
    ["SectionA1", "SectionA2"],
    ["SectionB1", "SectionB2"],
  ] as const;
  for (const [index, [left, right]] of pairs.entries()) {
    await clearSelection(page);
    const leftBox = boxes.get(left);
    const rightBox = boxes.get(right);
    if (!leftBox || !rightBox) throw new Error(`${left} and ${right} were not seeded`);
    const pair = unionOf([leftBox, rightBox]);
    await marqueeAround(page, {
      from: { x: pair.x - 10, y: pair.y - 10 },
      to: { x: pair.x + pair.width + 10, y: pair.y + pair.height + 10 },
    });
    await expect(selectedNodes(page)).toHaveCount(2);
    await page.keyboard.press("Control+g");
    await expect(page.locator(".section-header")).toHaveCount(index + 1);
    await page.keyboard.press("Escape");
  }

  await clearSelection(page);
  await marqueeOver(page, [...boxes.values()]);
  await expect(selectedNodes(page)).toHaveCount(titles.length);

  await expectPageInteractive(page, titles.length);
  expect(errors, "a multi-section marquee logged a console error").toEqual([]);
});

/**
 * Regression for A10: a peer's drag streamed presence through the board while the
 * box was open. Every peer tick changed the memos behind `applyBoardNodes`, whose
 * identity sat in the listener effect's dependencies; the effect's cleanup
 * released `marqueeActive`, and the next repaint wrote the store's stale
 * selection over React Flow's live one. The box then closed empty with no error.
 *
 * The box ends short of the pane edge on purpose: a pointer held on the edge
 * auto-pans React Flow, and `onlyRenderVisibleElements` unmounts every card that
 * leaves the viewport, so the DOM assertion below would read zero for a reason
 * that has nothing to do with selection.
 */
test("stays interactive when a peer drags during the marquee", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const errors = watchErrors(pageA);
  const url = workspaceUrl("peer-drag");

  await pageA.goto(url);
  await pageB.goto(url);
  // `expectPeersConnected` asserts the seeded starter cards, and this board is
  // blank on purpose: wait for the same warm channel without the card count.
  for (const peer of [pageA, pageB]) {
    await expect(peer.getByTestId("sync-status")).toHaveText(/Live/);
    await expect(peer.getByTestId("sync-status")).toHaveText(/2 here/);
  }

  const titles = ["PeerOne", "PeerTwo", "PeerThree", "PeerFour"];
  const boxes = await seedGrid(pageA, titles);
  // B's own viewport was fitted to an empty board, so it may not draw the cards
  // it has; fitting it is what a person would do, and `onlyRenderVisibleElements`
  // means an off-screen card is not in the DOM at all.
  await pageB.locator(".react-flow__controls-fitview").click();
  await expect(cards(pageB)).toHaveCount(titles.length);

  const peerCard = pageB.locator('[data-testid="node-card"]').filter({ hasText: "PeerOne" });
  const peerBox = await peerCard.boundingBox();
  if (!peerBox) throw new Error("the peer cannot see its card");
  // Far enough below and right of the grid to still cover PeerOne once the peer
  // has dragged it, but clear of the auto-pan edge.
  const all = unionOf([...boxes.values()]);
  const board = await pageA.getByTestId("canvas-board").boundingBox();
  if (!board) throw new Error("canvas board not found");
  const end = {
    x: Math.min(all.x + all.width + 12, board.x + board.width - 60),
    y: Math.min(all.y + all.height + 170, board.y + board.height - 60),
  };
  const start = await paneStartBefore(pageA, [...boxes.values()]);

  // The peer starts moving first, so its presence updates land while the box is
  // still being drawn instead of after it settles.
  await pageB.mouse.move(peerBox.x + 40, peerBox.y + 14);
  await pageB.mouse.down();
  await pageB.mouse.move(peerBox.x + 70, peerBox.y + 40, { steps: 4 });

  await beginMarquee(pageA, start, end, 20);
  await expect(selectedNodes(pageA)).toHaveCount(titles.length);

  // The peer's drop is a document write and a board rebuild on A while the box
  // is open: the selection has to survive it, not just the pointer frames.
  await pageB.mouse.move(peerBox.x + 120, peerBox.y + 100, { steps: 10 });
  await pageB.mouse.up();
  await expect(selectedNodes(pageA)).toHaveCount(titles.length);

  await finishMarquee(pageA);
  await expect(selectedNodes(pageA)).toHaveCount(titles.length);

  await expectPageInteractive(pageA, titles.length);
  expect(errors, "a peer drag during a marquee logged a console error").toEqual([]);

  await contextA.close();
  await contextB.close();
});

/**
 * Regression for A10: a cancelled box must leave nothing behind. React Flow
 * clears `userSelectionActive` only in its pane `pointerup`, which a release
 * outside the pane never reaches, and the app's listener effect used to drop
 * `marqueeActive` in its cleanup on every re-subscribe, so a mid-gesture
 * re-render released the guard before the cancel arrived. A stale guard or a
 * stale `userSelectionActive` leaves later marquees neither painting nor
 * selecting.
 *
 * The geometry is re-read between gestures: the inspector round trip inside
 * `expectPageInteractive` moves the viewport, and a box that ends near the pane
 * edge auto-pans React Flow, so coordinates read once would drift.
 */
test("cancelling a marquee mid-gesture leaves the page usable", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(workspaceUrl("cancel"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  const titles = ["CancelOne", "CancelTwo", "CancelThree"];
  await seedGrid(page, titles);

  const geometry = async () => {
    // Re-fit before every measurement. The inspector round trip in
    // `expectPageInteractive` changes the viewport, and a marquee that ends near
    // the pane edge auto-pans React Flow, so a box drawn from coordinates read
    // before either of those would miss the card it was aimed at.
    await page.locator(".react-flow__controls-fitview").click();
    await settleViewport(page);
    const all = unionOf(
      await Promise.all(
        titles.map(async (title) => {
          const box = await cardByTitle(page, title).boundingBox();
          if (!box) throw new Error(`"${title}" is not visible`);
          return box;
        }),
      ),
    );
    return { all, start: await paneStartBefore(page, [all]) };
  };

  // Escape cancels the box while the pointer is still down.
  const first = await geometry();
  await beginMarquee(
    page,
    first.start,
    { x: first.all.x + first.all.width + 8, y: first.all.y + first.all.height + 8 },
    6,
  );
  await expect(selectedNodes(page)).toHaveCount(titles.length);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expectPageInteractive(page, titles.length);

  // The pointer is released outside the pane: the marquee never ends on its own
  // surface, which is the path the guard leaked on.
  const second = await geometry();
  await beginMarquee(
    page,
    second.start,
    { x: second.all.x + second.all.width + 8, y: second.all.y + second.all.height + 8 },
    6,
  );
  await expect(selectedNodes(page)).toHaveCount(titles.length);
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expectPageInteractive(page, titles.length);

  // The same three cards still select after the cancelled gesture: React Flow's
  // per-gesture set cache is invalidated by the empty first commit of a new box.
  const third = await geometry();
  await marqueeOver(page, [third.all]);
  await expect(selectedNodes(page)).toHaveCount(titles.length);

  // A marquee over one card still selects exactly that card.
  await clearSelection(page);
  const one = await cardByTitle(page, "CancelOne").boundingBox();
  if (!one) throw new Error("CancelOne is not visible");
  await marqueeAround(page, {
    from: { x: one.x - 10, y: one.y - 10 },
    to: { x: one.x + 40, y: one.y + 30 },
  });
  await expect(selectedNodes(page)).toHaveCount(1);

  expect(errors, "cancelling a marquee logged a console error").toEqual([]);
});

/**
 * A10 §6.4: local drags ease the rendered delta only, so the drop is still the
 * pointer position and the CRDT is written once. One `Control+z` has to return
 * the card to where the gesture started; if the ease wrote intermediate
 * placements, the first undo would land somewhere along the drag. The frame-rate
 * side of this (60/120 Hz) is a manual check, noted in
 * `apps/canvas/src/canvas/localEasing.test.ts`.
 */
test("a local drag commits once per gesture", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(workspaceUrl("drag-commit"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  const titles = ["DragOnce"];
  const boxes = await seedGrid(page, titles);
  const before = boxes.get("DragOnce");
  if (!before) throw new Error("DragOnce was not seeded");

  // `dragCardTo` already asserts the card landed within 6 px of the pointer,
  // which is what proves the easing is render-only.
  await dragCardTo(page, "DragOnce", { x: before.x + 180, y: before.y + 120 });
  const landed = await cardByTitle(page, "DragOnce").boundingBox();
  if (!landed) throw new Error("the card is gone after the drag");
  expect(Math.round(landed.x)).toBeGreaterThan(Math.round(before.x) + 120);

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => Math.round((await cardByTitle(page, "DragOnce").boundingBox())?.x ?? -1))
    .toBeLessThan(Math.round(before.x) + 6);
  // A gesture that wrote nothing would have undone the card's creation instead.
  await expect(cardByTitle(page, "DragOnce")).toHaveCount(1);

  expect(errors, "a local drag logged a console error").toEqual([]);
});
