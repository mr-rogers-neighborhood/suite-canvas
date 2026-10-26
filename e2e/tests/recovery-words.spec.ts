import { expect, type Page, test } from "@playwright/test";
import { cards, workspaceIdFactory } from "./support";

/**
 * No owner fragment here: the app generates and claims a real 32-byte key on
 * the first visit, which is the shape the recovery words encode (12 words would
 * only carry 16 bytes).
 */
const id = workspaceIdFactory("e2e-recovery");

async function openRecoveryDialog(page: Page): Promise<void> {
  await page.getByTestId("workspace-file").click();
  await expect(page.getByTestId("workspace-recovery-key")).toBeVisible();
  await page.getByTestId("workspace-recovery-key").click();
  await expect(page.getByTestId("recovery-dialog")).toBeVisible();
}

/**
 * The words render one per list item as `1word`, so the number prefix is split
 * off. Missing indices would make this shorter than 24.
 */
async function revealedWords(page: Page): Promise<string[]> {
  const items = await page.getByTestId("recovery-words").locator("li").allTextContents();
  return items.map((item) => item.replace(/^\d+/, "").trim());
}

test("shows 24 words, rejects a mistyped word, and restores access from the phrase", async ({
  page,
  browser,
}) => {
  const workspace = id("words");
  await page.goto(`/?workspace=${workspace}`);
  await expect(cards(page)).toHaveCount(2);

  await openRecoveryDialog(page);
  await page.getByTestId("recovery-words-open").click();
  await page.getByTestId("recovery-words-reveal").click();
  await expect(page.getByTestId("recovery-words").locator("li")).toHaveCount(24);
  const words = await revealedWords(page);
  expect(words).toHaveLength(24);
  expect(words.every((word) => word.length > 0)).toBe(true);

  // A new browser has neither the key nor the cached document, so the phrase is
  // the only way in.
  const fresh = await browser.newContext();
  try {
    const freshPage = await fresh.newPage();
    await freshPage.goto(`/?workspace=${workspace}`);
    await expect(freshPage.getByTestId("workspace-protected")).toBeVisible();
    await freshPage.getByTestId("recovery-words-open").click();

    // One wrong word is caught before anything is written, with a sentence that
    // says what to check.
    const candidates = ["abandon", "ability", "able", "about", "above", "absent"];
    const replacement = candidates.find((word) => word !== words[0]);
    if (replacement === undefined) throw new Error("no alternate word for the typo");
    const mistyped = [replacement, ...words.slice(1)].join(" ");

    const input = freshPage.getByTestId("recovery-words-input");
    await input.fill(mistyped);
    await freshPage.getByTestId("recovery-words-apply").click();
    await expect(freshPage.getByTestId("recovery-error")).toHaveText(
      /not a recovery word|checksum|do not open this workspace/,
    );
    await expect(freshPage.getByTestId("workspace-protected")).toBeVisible();

    // The exact phrase installs the key and opens the workspace.
    await input.fill(words.join(" "));
    await freshPage.getByTestId("recovery-words-apply").click();
    await expect(freshPage.locator('.app-canvas[data-ready="true"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(freshPage.getByTestId("workspace-protected")).toHaveCount(0);
    await expect(cards(freshPage)).toHaveCount(2);
  } finally {
    await fresh.close();
  }
});
