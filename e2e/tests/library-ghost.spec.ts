import { expect, test } from "@playwright/test";
import { expectPeersConnected } from "../interactions";
import { libraryRows, openLibrary } from "./support";

/**
 * Dragging a card out of the library is a gesture one person makes and everyone
 * else needs to see: the drawer's own ghost is local, so the canvas publishes a
 * flow-space preview and peers draw where the card would land.
 */

const docUrl = () =>
  `/?doc=e2e-library-ghost-${Date.now()}-${crypto.randomUUID()}#owner=${crypto.randomUUID()}`;

test("a peer sees the card being dragged out of the library", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = docUrl();
  await pageA.goto(url);
  await pageB.goto(url);
  await expectPeersConnected(pageA, pageB);

  // A card that only lives in the inbox, so the drag has somewhere to start.
  await pageA.getByTestId("dock-new-card").click();
  await pageA.getByTestId("dock-type-note").click();
  await pageA.keyboard.type("Library card");
  await pageA.keyboard.press("Escape");
  await pageA.locator(".card-header").first().click({ button: "right" });
  await pageA.getByRole("menuitem", { name: "Remove from board" }).click();
  await openLibrary(pageA, "inbox");
  await expect(libraryRows(pageA)).toHaveCount(1);

  // Nothing held yet: no ghost on either page.
  await expect(pageB.getByTestId("peer-library-ghost")).toHaveCount(0);

  const row = libraryRows(pageA).first();
  const box = await row.boundingBox();
  const canvas = await pageA.getByTestId("canvas-board").boundingBox();
  if (!box || !canvas) throw new Error("cannot measure");

  await pageA.mouse.move(box.x + 60, box.y + box.height / 2);
  await pageA.mouse.down();
  await pageA.mouse.move(box.x + 90, box.y + box.height / 2 + 10, { steps: 6 });
  // Over the middle of the canvas, still held.
  await pageA.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 10 });

  // The dragger sees where it will land *on the board*: a frame at the pointer, in
  // board space, so the drop is not a guess (ADR-0011 §2).
  await expect(pageA.getByTestId("library-drop-preview")).toHaveCount(1);
  // The frame names the card being held. The row's text also carries its `⋯`, so
  // the comparison is on the title line rather than the whole row.
  await expect(pageA.locator(".library-drop-preview__title")).toHaveText(
    (await row.locator("p").first().innerText()).trim(),
  );
  await expect(pageB.getByTestId("peer-library-ghost")).toHaveCount(1);
  // It carries the peer's name, so the ghost is attributable: who is dragging
  // is the useful fact, and the title can still be in flight to this client.
  await expect(pageB.locator(".peer-library-ghost__name")).not.toBeEmpty();

  // Releasing places exactly one card, and the ghost goes away on both sides.
  await pageA.mouse.up();
  await expect(pageA.getByTestId("library-drop-preview")).toHaveCount(0);
  await expect(pageB.getByTestId("peer-library-ghost")).toHaveCount(0);
  await expect(
    pageB.locator('[data-testid="node-card"]').filter({ hasText: "Library card" }),
  ).toHaveCount(1);

  await contextA.close();
  await contextB.close();
});
