import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";

const workspaceUrl = (name: string, extra = "") =>
  withOwnerKey(`/?workspace=e2e-scene-${name}-${Date.now()}&fresh=1${extra}`, "scene");

const sceneCards = (page: Page) => page.locator('[data-testid="scene-card"]');

test("opens a seeded fractal scene on a new workspace", async ({ page }) => {
  await page.goto(workspaceUrl("seed"));

  await expect(page.getByTestId("scene-board")).toBeVisible();
  await expect(page.getByTestId("scene-preview-root")).toContainText("Atlas");
  await expect(page.getByRole("tab")).toHaveCount(3);
  await expect(sceneCards(page).first()).toBeVisible();
  expect(await page.locator('[data-testid="scene-portal"]').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("scene-preview-flow-link")).toHaveAttribute(
    "href",
    expect.stringContaining("canvas=flow"),
  );
});

test("enters a portal through the camera and restores it with Escape", async ({ page }) => {
  await page.goto(workspaceUrl("focus"));

  const focus = page.getByRole("button", { name: "Focus Research" }).first();
  await expect(focus).toBeVisible();
  const box = await focus.boundingBox();
  if (!box) throw new Error("the portal focus target has no box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.getByTestId("scene-preview-root")).toContainText("Atlas / Research");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("scene-preview-root")).not.toContainText("/ Research");
});

test("creates a note from the scene canvas menu", async ({ page }) => {
  await page.goto(workspaceUrl("create"));

  const before = await sceneCards(page).count();
  const surface = page.getByTestId("scene-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("the scene surface has no box");
  await page.mouse.click(box.x + 48, box.y + box.height - 48, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  const item = page.getByRole("menuitem", { name: "New note" });
  const itemBox = await item.boundingBox();
  if (!itemBox) throw new Error("the New note item has no box");
  await page.mouse.click(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);

  await expect.poll(() => sceneCards(page).count()).toBeGreaterThan(before);
});

test("reports scene render counters and non-zero badge counts with ?perf=1", async ({ page }) => {
  await page.goto(workspaceUrl("perf", "&perf=1"));

  await expect(page.getByTestId("scene-board")).toBeVisible();
  await expect(page.getByTestId("perf-key").first()).toBeVisible();
  // Boot timings are recorded by the store/shell, so the panel must have them.
  await expect(page.getByTestId("perf-boot")).toBeVisible();

  // `scene-card` is counted by every rendered card projection, so seeing it
  // proves the scene surface (not the flow board) is what painted. Rates are a
  // one-second window, hence the poll: a key drops out when it goes idle.
  await expect
    .poll(async () => page.getByTestId("perf-key").allInnerTexts())
    .toEqual(expect.arrayContaining(["scene-card", "shell"]));

  // The badge is fed by the projection's own counts, so zeros would mean the
  // seeded workspace never reached the scene. Frame times are deliberately not
  // asserted: they depend on the machine, not on the projection being correct.
  const counts = page.getByTestId("scene-preview-counts");
  await expect(counts).toHaveText(/^\d+ boards · \d+ cards · \d+ portals$/);
  const numbers = (await counts.innerText()).match(/\d+/g)?.map(Number) ?? [];
  expect(numbers).toHaveLength(3);
  expect(numbers[0]).toBeGreaterThan(0);
  expect(numbers[1]).toBeGreaterThan(0);
});

test("keeps the legacy flow surface reachable", async ({ page }) => {
  await page.goto(withOwnerKey(`/?workspace=e2e-scene-flow-${Date.now()}`, "flow"));

  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await expect(page.getByTestId("scene-board")).toHaveCount(0);
});
