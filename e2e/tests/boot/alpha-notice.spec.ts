import { expect, test } from "@playwright/test";

/**
 * The alpha notice (`launcher/AlphaNotice.tsx`).
 *
 * It greets a browser that has not read it in the last ten minutes, which during
 * alpha is every fresh visit. Its unit tests cover the stamp; this covers the
 * surface: the three facts are there, "Got it" dismisses it, a reload a moment
 * later stays dismissed, and a visit beyond the window is greeted again.
 */
test("a fresh browser is greeted and one press dismisses it", async ({ page }) => {
  await page.goto("/");

  const notice = page.getByTestId("alpha-notice");
  await expect(notice).toBeVisible();
  // What is rough, what money buys, and where the work actually lives.
  await expect(notice).toContainText("alpha software");
  await expect(notice).toContainText("A subscription is early access");
  await expect(notice).toContainText("Your work is saved in this browser");
  await expect(notice.getByTestId("alpha-notice-github")).toBeVisible();

  await notice.getByTestId("alpha-notice-dismiss").click();
  await expect(page.getByTestId("alpha-notice")).toHaveCount(0);

  // A reload a moment later is not a reason to say it again.
  await page.reload();
  await expect(page.getByTestId("workspace-launcher")).toBeVisible();
  await expect(page.getByTestId("alpha-notice")).toHaveCount(0);
});

test("a visit past the ten minutes is greeted again", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("alpha-notice-dismiss").click();
  await expect(page.getByTestId("alpha-notice")).toHaveCount(0);

  // The whole of the rule is the timestamp, so moving it is the same as coming
  // back tomorrow: somebody using alpha software should be reminded what it is.
  await page.evaluate(() => {
    window.localStorage.setItem("suite.alpha-notice.v2", String(Date.now() - 11 * 60 * 1000));
  });
  await page.reload();
  await expect(page.getByTestId("alpha-notice")).toBeVisible();
});
