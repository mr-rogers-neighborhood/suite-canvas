import { expect, test } from "@playwright/test";
import { withOwnerKey } from "./ownerUrl";
import { cardByTitle, cards, createNote, workspaceIdFactory } from "./support";

const id = workspaceIdFactory("e2e-sign-in");
const workspaceUrl = (name: string) => withOwnerKey(`/?workspace=${id(name)}`);

/**
 * The account surface on a deployment with no account service.
 *
 * Every test below runs against the dev server, which serves the canvas and the
 * relay and **no** Better Auth: `/api/auth/ok` is a 404. That is the honest path
 * this lane must get right, so it is the path the spec asserts — a dialog that
 * says accounts are unavailable here, and a canvas that keeps editing regardless.
 *
 * The pending-account case has no server either, so it is stubbed at the network
 * boundary: the deployment answers `ok`, the session reports `admittedAt: null`,
 * and the admission-gated call claim-on-sign-in needs (creating the account's
 * first organization) is refused with `admission-pending`, exactly as
 * `services/auth` refuses it. What is under test is our surface, not Better Auth.
 */

const dialog = (page: import("@playwright/test").Page) => page.getByTestId("sign-in-dialog");

test("the header's Sign in opens a dialog that says so when accounts are unavailable", async ({
  page,
}) => {
  await page.goto(workspaceUrl("unavailable"));
  await expect(cards(page)).toHaveCount(2);

  await page.getByTestId("sign-in-entry").click();
  await expect(dialog(page)).toBeVisible();
  // The probe answers from the network, so the state is awaited rather than assumed.
  await expect(dialog(page)).toHaveAttribute("data-availability", "unavailable");

  await expect(page.getByTestId("auth-unavailable")).toContainText(
    "Accounts are not available on this deployment",
  );
  await expect(page.getByTestId("auth-unavailable")).toContainText(
    "editing, import and export keep working without an account",
  );
  // No dead buttons: three ways in that cannot work would all be worse than none.
  await expect(page.getByTestId("sign-in-passkey")).toHaveCount(0);
  await expect(page.getByTestId("sign-in-magic-link")).toHaveCount(0);
  await expect(page.getByTestId("sign-in-google")).toHaveCount(0);

  await page.getByTestId("sign-in-close").click();
  await expect(dialog(page)).toHaveCount(0);

  // The point of the whole dialog: it never had the workspace to begin with.
  await createNote(page, "Local note");
  await expect(cardByTitle(page, "Local note")).toHaveCount(1);
  await page.getByTestId("sync-status").click();
  await expect(page.getByTestId("storage-status")).toBeVisible();
});

test("a session waiting for admission sees the panel, and can still work locally", async ({
  page,
}) => {
  await page.route("**/api/auth/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/ok")) {
      await route.fulfill({ status: 200, json: { ok: true } });
      return;
    }
    if (path.endsWith("/get-session")) {
      await route.fulfill({
        status: 200,
        json: {
          session: { id: "session-1", userId: "user-1", expiresAt: Date.now() + 3_600_000 },
          user: { id: "user-1", email: "held@example.com", admittedAt: null },
        },
      });
      return;
    }
    if (path.endsWith("/organization/list")) {
      await route.fulfill({ status: 200, json: [] });
      return;
    }
    if (path.endsWith("/organization/create")) {
      // The one gate an account meets here: creating a tenant while it waits.
      await route.fulfill({
        status: 403,
        json: {
          code: "admission-pending",
          message: "You're on the list. We'll email you when your workspace is ready.",
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { code: "not-found" } });
  });

  await page.goto(workspaceUrl("pending"));
  await expect(cards(page)).toHaveCount(2);

  const panel = page.getByTestId("admission-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("admission-message")).toHaveText(
    "You're on the list. We'll email you when your workspace is ready.",
  );
  await expect(page.getByTestId("admission-local")).toContainText(
    "Local editing, import and export are unaffected",
  );

  // Not a wall: one click hands the canvas back.
  await page.getByTestId("admission-keep-working").click();
  await expect(panel).toHaveCount(0);

  await createNote(page, "Still editable");
  await expect(cardByTitle(page, "Still editable")).toHaveCount(1);

  // And reachable again later, from the header chip.
  await page.getByTestId("account-waiting").click();
  await expect(panel).toBeVisible();
});
