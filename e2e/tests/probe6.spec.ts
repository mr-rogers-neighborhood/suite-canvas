import { expect, test } from "@playwright/test";
import { ACCOUNT_STATE, hostedUrl } from "./fixtures/account";

test.use({ storageState: ACCOUNT_STATE });

test("probe claims", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/workspaces/claim"))
      posts.push(`${r.method()} ${r.postData() ?? ""}`);
  });
  page.on("response", async (r) => {
    if (r.url().includes("/api/workspaces/claim")) {
      console.log("[claim]", r.status(), await r.text().catch(() => ""));
    }
  });
  const url = hostedUrl(`/?fresh=1&workspace=e2e-probeclaim-${Date.now()}`);
  console.log("[url]", url);
  await page.goto(url);
  await expect(page.getByTestId("canvas-board")).toBeVisible();
  await page.waitForTimeout(4000);
  console.log("[posts]", JSON.stringify(posts));
});
