import { expect, type Page, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { inspector, libraryRows, openCardInspector, openLibrary } from "./support";

/**
 * The inspector is the card's editable surface now.
 *
 * ICE draws cards on the GPU and mounts no DOM card face (`SUITE_CARD_DOM_FACE`
 * is false in `icePen`/`suitePen`), so there is no on-canvas editor to type
 * into and no `[data-testid="node-card"]` to read back. What survived is the
 * panel: its Details/Content tabs, the title and body editors, and the
 * full-canvas focus surface. The old "…and shows it on the canvas card" half of
 * these tests, and the peer-caret-in-a-card test, died with that face.
 */

let sequence = 0;
const workspaceUrl = (name: string) =>
  withOwnerKey(`/?workspace=e2e-panel-${name}-${Date.now()}-${++sequence}`);

const BODY_PLACEHOLDER = "Begin writing, or type / for commands.";

/** Details holds the metadata; an empty card opens on Content instead. */
async function showDetails(page: Page): Promise<void> {
  await page.getByTestId("card-panel-tab-details").click();
  await expect(page.getByTestId("card-panel-details")).toBeVisible();
}

test("edits the body and the title in the inspector", async ({ page }) => {
  await page.goto(workspaceUrl("body"));
  const panel = await openCardInspector(page);

  // Clicking the read-only body moves the editable surface into the panel.
  await page.getByTestId("card-panel-body").click();
  const panelEditor = page.locator(".card-inspector .node-card-editor.ProseMirror-focused");
  await expect(panelEditor).toHaveCount(1);

  await page.keyboard.type("Typed from the panel");
  await expect(page.locator(".card-inspector .node-card-editor")).toContainText(
    "Typed from the panel",
  );

  // The title is editable from the panel too, through the same handover.
  await page.getByTestId("card-panel-title").click();
  await expect(page.locator(".card-inspector .card-title-editor.ProseMirror-focused")).toHaveCount(
    1,
  );
  await page.keyboard.type("Panel title");
  await showDetails(page);
  await expect(panel.getByTestId("card-panel-title")).toContainText("Panel title");

  // Both writes are document truth: the row and a reopened panel show them.
  await expect(libraryRows(page).filter({ hasText: "Panel title" })).toHaveCount(1);
  await panel.getByTestId("inspector-close").click();
  const reopened = await openCardInspector(page, { title: "Panel title" });
  await reopened.getByTestId("card-panel-tab-content").click();
  await expect(reopened.getByTestId("card-panel-body")).toContainText("Typed from the panel");
});

test("splits the inspector into Details and Content tabs", async ({ page }) => {
  await page.goto(workspaceUrl("tabs"));
  await openCardInspector(page);

  const detailsTab = page.getByTestId("card-panel-tab-details");
  const contentTab = page.getByTestId("card-panel-tab-content");
  await expect(detailsTab).toHaveText("Details");
  await expect(contentTab).toHaveText("Content");

  // A blank card starts where the writing happens, not under the metadata.
  await expect(contentTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("card-panel-body")).toBeVisible();
  await expect(page.getByTestId("card-panel-details")).toHaveCount(0);

  await showDetails(page);
  await expect(detailsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("type-picker")).toBeVisible();
  await expect(page.getByTestId("card-panel-body")).toHaveCount(0);

  // Edit opens the card full-canvas, which lands on the body with the caret in it.
  await page.getByTestId("inspector-edit").click();
  await expect(page.getByTestId("card-focus")).toBeVisible();
  await expect(
    page.locator(".card-focus .card-panel-body .node-card-editor.ProseMirror-focused"),
  ).toHaveCount(1);
  // The drawer is gone; the same tabs now live on the focus surface.
  await expect(page.getByTestId("card-inspector")).toHaveCount(0);

  await page.getByTestId("card-focus-back").click();
  await expect(page.getByTestId("card-focus")).toHaveCount(0);
});

test("shows the empty-body placeholder in the inspector", async ({ page }) => {
  await page.goto(workspaceUrl("placeholder"));
  await openCardInspector(page);

  const panelPlaceholder = page.locator(".card-inspector .card-panel-body p.is-editor-empty");
  await expect(panelPlaceholder).toHaveAttribute("data-placeholder", BODY_PLACEHOLDER);

  // The decoration is what paints the copy; the body itself stays empty.
  const painted = await panelPlaceholder.evaluate(
    (element) => getComputedStyle(element, "::before").content,
  );
  expect(painted).toContain(BODY_PLACEHOLDER);
});

test("syncs panel text between two clients' inspectors", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const url = workspaceUrl("two-clients");
  await pageA.goto(url);
  await pageB.goto(url);
  await expect(pageB.locator(".app-canvas")).toHaveAttribute("data-ready", "true");

  await openCardInspector(pageA);
  await pageA.getByTestId("card-panel-body").click();
  await expect(pageA.locator(".card-inspector .node-card-editor.ProseMirror-focused")).toHaveCount(
    1,
  );
  await pageA.keyboard.type("Panel to peer");

  // The peer reads the shared body in its own inspector.
  await openLibrary(pageB, "cards");
  await libraryRows(pageB).first().click();
  await expect(inspector(pageB)).toBeVisible();
  await inspector(pageB).getByTestId("card-panel-tab-content").click();
  await expect(inspector(pageB).getByTestId("card-panel-body")).toContainText("Panel to peer");

  await contextA.close();
  await contextB.close();
});
