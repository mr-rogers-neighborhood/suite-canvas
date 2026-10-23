import { expect, type Page, test } from "@playwright/test";
import {
  beginMarquee,
  cards,
  clearSelection,
  expectPageInteractive,
  finishMarquee,
  marqueeOver,
  type Point,
  paneStartBefore,
  seedGrid,
  selectedNodes,
  unionOf,
  watchErrors,
} from "./marquee";
import { withOwnerKey } from "./ownerUrl";

let sequence = 0;
/** A blank board: `fresh=1` skips the two starter cards, so counts are exact. */
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?fresh=1&workspace=e2e-marquee-${name}-${Date.now()}-${++sequence}`);

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
 * Reproduced, not fixed: React Flow's pane keeps a `selectedNodeIds` ref across
 * gestures, and a peer's drag rebuild replaces our controlled `nodes` array
 * while the box is open. `nodeLookup` still reports four selected nodes, but the
 * painted nodes say `false`, so React Flow syncs the selection away and the
 * marquee closes with an empty selection and no error. Tracked as an A10
 * blocker; the assertions below are the acceptance test for the fix.
 */
test.fixme("stays interactive when a peer drags during the marquee", async ({ browser }) => {
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

  // The peer drags a card for the whole gesture: every animation frame of the
  // local marquee competes with the peer's eased position updates.
  const peerCard = pageB.locator('[data-testid="node-card"]').filter({ hasText: "PeerOne" });
  const peerBox = await peerCard.boundingBox();
  if (!peerBox) throw new Error("the peer cannot see its card");
  // End at the pane's far corner: the peer moves a card during the gesture, and
  // a box drawn tight to the original grid would miss the card it moved.
  const board = await pageA.getByTestId("canvas-board").boundingBox();
  if (!board) throw new Error("canvas board not found");
  await beginMarquee(
    pageA,
    await paneStartBefore(pageA, [...boxes.values()]),
    { x: board.x + board.width - 8, y: board.y + board.height - 8 },
    20,
  );

  await pageB.mouse.move(peerBox.x + 40, peerBox.y + 14);
  await pageB.mouse.down();
  await pageB.mouse.move(peerBox.x + 120, peerBox.y + 100, { steps: 12 });
  await pageB.mouse.up();

  await finishMarquee(pageA);
  await expect(selectedNodes(pageA)).toHaveCount(titles.length);

  await expectPageInteractive(pageA, titles.length);
  expect(errors, "a peer drag during a marquee logged a console error").toEqual([]);

  await contextA.close();
  await contextB.close();
});

/**
 * Reproduced, not fixed: releasing the box outside the pane (or over a control
 * panel) skips React Flow's pane `pointerup`, so its internal
 * `selectedNodeIds` ref keeps the cancelled set. A later marquee that covers the
 * same cards then computes an equal set, emits no selection change, and selects
 * nothing. The app's guard is released correctly (the page stays interactive);
 * the stale ref is inside React Flow. Tracked as an A10 blocker.
 */
test.fixme("cancelling a marquee mid-gesture leaves the page usable", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(workspaceUrl("cancel"));
  await expect(page.getByTestId("canvas-board")).toBeVisible();

  const titles = ["CancelOne", "CancelTwo", "CancelThree"];
  const boxes = await seedGrid(page, titles);
  const all = unionOf([...boxes.values()]);
  const start = await paneStartBefore(page, [...boxes.values()]);
  const corner = { x: all.x + all.width + 8, y: all.y + all.height + 8 };

  // Escape cancels the box while the pointer is still down.
  await beginMarquee(page, start, corner, 6);
  await expect(selectedNodes(page)).toHaveCount(titles.length);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expectPageInteractive(page, titles.length);

  // The pointer is released outside the pane: the marquee never ends on its own
  // surface, which is the path the old `marqueeActive` guard leaked on.
  await beginMarquee(page, start, corner, 6);
  await page.mouse.move(4, 4);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expectPageInteractive(page, titles.length);

  // A later marquee still selects exactly what it touches.
  const first = boxes.get("CancelOne");
  if (!first) throw new Error("CancelOne was not seeded");
  await marqueeAround(page, {
    from: { x: first.x - 10, y: first.y - 10 },
    to: { x: first.x + 40, y: first.y + 30 },
  });
  await expect(selectedNodes(page)).toHaveCount(1);

  expect(errors, "cancelling a marquee logged a console error").toEqual([]);
});
