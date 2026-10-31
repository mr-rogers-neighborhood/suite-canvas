import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntitlementView } from "./entitlement";
import { useAccountStore } from "./useAccountStore";

const listPlans = vi.fn();
const readSubscription = vi.fn();
const readEntitlement = vi.fn();
const ensureOrganization = vi.fn();

vi.mock("./billing", () => ({
  listPlans: () => listPlans(),
  readSubscription: (id: string) => readSubscription(id),
  readEntitlement: (id: string) => readEntitlement(id),
  readStorageUsage: vi.fn(async () => ({ attachmentBytes: 0, documentBytes: 0 })),
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));
vi.mock("./organization", () => ({
  ensureOrganization: () => ensureOrganization(),
  ORGANIZATION_NAME: "Personal",
}));

const { PlanPanel } = await import("./PlanPanel");

const ENTITLEMENT: EntitlementView = {
  tier: "team",
  organizationId: "org-1",
  role: "owner",
  limits: { seats: 5, documentBytes: 2_147_483_648 },
  quota: [
    {
      id: "documentBytes",
      label: "Document storage",
      limit: 2_147_483_648,
      value: "2.0 GB",
      zero: false,
    },
    { id: "seats", label: "Team members", limit: 5, value: "5", zero: false },
  ],
  refreshesAt: 1_700_000_000_000,
};

/** The token a plan-less organization holds: tier `free`, and no limits at all. */
const FREE: EntitlementView = {
  tier: "free",
  organizationId: "org-1",
  role: "owner",
  limits: {},
  quota: [],
  refreshesAt: null,
};

beforeEach(() => {
  useAccountStore.setState({ phase: "signed-in", dialogOpen: false, dialogMode: "sign-in" });
  listPlans.mockReset();
  readSubscription.mockReset();
  readEntitlement.mockReset();
  ensureOrganization.mockReset();
  ensureOrganization.mockResolvedValue({ ok: true, organizationId: "org-1" });
  readSubscription.mockResolvedValue({ ok: true, value: null });
  readEntitlement.mockResolvedValue({ ok: true, value: { tier: "free", limits: {} } });
});

describe("the plan surface", () => {
  it("shows the tier the token carries and the limits that come with it", () => {
    render(<PlanPanel entitlement={ENTITLEMENT} readOnMount={false} />);
    expect(screen.getByTestId("plan-tier")).toHaveTextContent("team");
    expect(screen.getByTestId("plan-tier")).toHaveTextContent("as owner");
    expect(screen.getByTestId("plan-quota")).toHaveTextContent("Team members");
    expect(screen.getByTestId("plan-quota")).toHaveTextContent("2.0 GB");
  });

  it("shows the free plan's zero rather than claiming the server sets no limits", () => {
    // The old copy said "This server sets no limits" under "You are on the free plan",
    // which is the opposite of what a free organization holds.
    render(<PlanPanel entitlement={FREE} readOnMount={false} />);

    expect(screen.getByTestId("plan-quota")).toHaveTextContent("Synced workspaces");
    expect(screen.getByTestId("plan-quota")).toHaveTextContent("Unlimited");
    expect(screen.getByTestId("plan-free-sentence")).toHaveTextContent("Everything on this device");
    expect(screen.queryByTestId("plan-no-limits")).not.toBeInTheDocument();
    expect(screen.queryByText(/sets no limits/u)).not.toBeInTheDocument();
  });

  it("says the cards are Stripe's test cards when the deployment is in test mode", async () => {
    listPlans.mockResolvedValue({
      ok: true,
      value: {
        mode: "test",
        plans: [{ name: "personal", priceId: null, limits: {}, price: null }],
      },
    });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-test-mode")).toHaveTextContent("No money is taken");
  });

  it("says the plan appears once signed in", () => {
    render(<PlanPanel entitlement={null} readOnMount={false} />);
    expect(screen.getByTestId("plan-tier")).toHaveTextContent("once you are signed in");
  });

  it("lists the plans a deployment sells", async () => {
    listPlans.mockResolvedValue({
      ok: true,
      value: {
        mode: "live",
        plans: [{ name: "personal", priceId: null, limits: {}, price: null }],
      },
    });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-checkout-personal")).toHaveTextContent(
      "Choose personal",
    );
    // A live deployment charges cards, so nothing here may claim otherwise.
    expect(screen.queryByTestId("plan-test-mode")).not.toBeInTheDocument();
  });

  it("reads the catalogue even when the host seeds the token's claims", async () => {
    // The regression this pins: `AccountPanel` passes `entitlement` so the tier is on
    // screen before the server answers, and the panel used that prop as "do not ask",
    // so the plan list was never fetched in the app at all.
    listPlans.mockResolvedValue({
      ok: true,
      value: {
        mode: "test",
        plans: [{ name: "personal", priceId: "price_1", limits: {}, price: null }],
      },
    });
    render(<PlanPanel entitlement={FREE} />);

    expect(screen.getByTestId("plan-tier")).toHaveTextContent("free plan");
    expect(await screen.findByTestId("plan-checkout-personal")).toHaveTextContent(
      "Choose personal",
    );
    expect(listPlans).toHaveBeenCalled();
  });

  it("hides the plans when a subscription already exists", async () => {
    listPlans.mockResolvedValue({
      ok: true,
      value: {
        mode: "test",
        plans: [{ name: "personal", priceId: "price_1", limits: {}, price: null }],
      },
    });
    readSubscription.mockResolvedValue({
      ok: true,
      value: { plan: "personal", status: "active", seats: 1, periodEnd: null },
    });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-portal")).toBeInTheDocument();
    // The portal is the door for a change to an existing plan; a second checkout is not.
    expect(screen.queryByTestId("plan-checkout-personal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("plan-catalogue-empty")).not.toBeInTheDocument();
  });

  it("asks for an account instead of a checkout when nobody is signed in", async () => {
    // A plan belongs to an account. Offering `Choose personal` to a signed-out reader
    // answered 401 and read as a broken plan list, which is the report this pins.
    useAccountStore.setState({ phase: "signed-out" });
    listPlans.mockResolvedValue({
      ok: true,
      value: {
        mode: "live",
        plans: [{ name: "personal", priceId: "price_1", limits: {}, price: null }],
      },
    });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-needs-account")).toHaveTextContent(
      "A plan belongs to an account. Make one first",
    );
    expect(screen.queryByTestId("plan-checkout-personal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("plan-create-account"));
    expect(useAccountStore.getState().dialogMode).toBe("sign-up");
    expect(useAccountStore.getState().dialogOpen).toBe(true);
  });

  it("says plans are unavailable, without naming a variable a reader cannot set", async () => {
    listPlans.mockResolvedValue({ ok: true, value: { mode: "test", plans: [] } });
    render(<PlanPanel />);

    const empty = await screen.findByTestId("plan-catalogue-empty");
    expect(empty).toHaveTextContent("Plans are not available right now");
    // The operator's own instructions belong in the runbook. A customer reading this panel
    // can do nothing with a variable name except wonder whether the fault is theirs.
    expect(empty).not.toHaveTextContent("STRIPE_PRICE_TIERS");
  });

  it("says the account service did not answer, and offers a retry", async () => {
    listPlans.mockResolvedValueOnce({
      ok: false,
      code: "unreachable",
      message: "The billing service did not answer, so nothing changed.",
    });
    render(<PlanPanel />);

    const unavailable = await screen.findByTestId("plan-unavailable");
    expect(unavailable).toHaveTextContent("did not answer");

    listPlans.mockResolvedValue({
      ok: true,
      value: {
        mode: "test",
        plans: [{ name: "personal", priceId: null, limits: {}, price: null }],
      },
    });
    fireEvent.click(screen.getByTestId("plan-retry"));

    await waitFor(() => expect(screen.getByTestId("plan-checkout-personal")).toBeInTheDocument());
  });

  it("offers the portal only once there is a customer to open it for", async () => {
    listPlans.mockResolvedValue({ ok: true, value: { mode: "test", plans: [] } });
    const without = render(<PlanPanel />);
    expect(await screen.findByTestId("plan-no-customer")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-portal")).not.toBeInTheDocument();
    without.unmount();

    readSubscription.mockResolvedValue({
      ok: true,
      value: { plan: "personal", status: "active", seats: 1, periodEnd: null },
    });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-portal")).toHaveTextContent("Manage billing in Stripe");
    expect(screen.queryByTestId("plan-no-customer")).not.toBeInTheDocument();
  });
});

describe("what a plan card says", () => {
  const priced = {
    name: "personal",
    priceId: "price_1",
    limits: {
      workspaces: 2_147_483_647,
      seats: 5,
      documentBytes: 268_435_456,
      attachmentBytes: 10_737_418_240,
    },
    price: { amount: 900, currency: "usd", interval: "month" },
  };

  it("shows the price, what it buys, and who it covers", async () => {
    listPlans.mockResolvedValue({ ok: true, value: { mode: "live", plans: [priced] } });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-price-personal")).toHaveTextContent("$9 / month");
    expect(screen.getByTestId("plan-allowance-personal-workspaces")).toHaveTextContent("Unlimited");
    expect(screen.getByTestId("plan-allowance-personal-documentBytes")).toHaveTextContent("256 MB");
    expect(screen.getByTestId("plan-allowance-personal-attachmentBytes")).toHaveTextContent(
      "10 GB",
    );
    // The allowance the invitation check counts, and the sentence that stops "5" reading as
    // "only five people may look": everybody else arrives by link.
    expect(screen.getByTestId("plan-allowance-personal-seats")).toHaveTextContent(
      "5, including you",
    );
    expect(screen.getByTestId("plan-allowance-personal-guests")).toHaveTextContent(
      "by share link, not counted",
    );
    expect(screen.getByTestId("plan-card-personal")).toHaveTextContent("unlimited workspaces");
  });

  it("says just you for a plan that admits one, rather than a bare number", async () => {
    listPlans.mockResolvedValue({
      ok: true,
      value: { mode: "live", plans: [{ ...priced, limits: { ...priced.limits, seats: 1 } }] },
    });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-allowance-personal-seats")).toHaveTextContent(
      "just you",
    );
  });

  it("offers self-hosting beside the plans, because it costs nothing and asks for no licence", async () => {
    listPlans.mockResolvedValue({ ok: true, value: { mode: "live", plans: [priced] } });
    render(<PlanPanel />);

    const card = await screen.findByTestId("plan-card-self-host");
    expect(card).toHaveTextContent("Free, forever");
    // A link, not a button: nothing about running it yourself charges anybody.
    expect(card.querySelector("a")?.getAttribute("href")).toMatch(/\/how-to\/deploy\/$/u);
    expect(within(card).queryByRole("button")).toBeNull();
  });

  it("separates a member from a guest, and says what the money is for", async () => {
    listPlans.mockResolvedValue({ ok: true, value: { mode: "live", plans: [priced] } });
    render(<PlanPanel />);

    const caveats = await screen.findByTestId("plan-caveats");
    // The two words that used to be one: a member is an account inside the organization and
    // counts against the allowance; a guest opens a link and does not.
    expect(caveats).toHaveTextContent("Members and guests");
    expect(caveats).toHaveTextContent("no seat");
    expect(caveats).toHaveTextContent("hundred of them");
    // And the reason somebody pays while the product is alpha, said plainly.
    expect(caveats).toHaveTextContent("And your support");
    expect(caveats).toHaveTextContent("Nothing is behind one");
    expect(caveats).toHaveTextContent("cancelled from the portal");
  });

  it("renders no amount when Stripe did not answer, rather than guessing one", async () => {
    listPlans.mockResolvedValue({
      ok: true,
      value: { mode: "live", plans: [{ ...priced, price: null }] },
    });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-price-personal")).toHaveTextContent("Price unavailable");
    // The allowances are the tier table's, so they still say what the plan buys.
    expect(screen.getByTestId("plan-allowance-personal-workspaces")).toHaveTextContent("Unlimited");
  });

  it("describes a tier it has never heard of from its own limits", async () => {
    listPlans.mockResolvedValue({
      ok: true,
      value: {
        mode: "live",
        plans: [{ ...priced, name: "studio", limits: { workspaces: 7 } }],
      },
    });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-card-studio")).toHaveTextContent(
      "For 7 synced workspaces",
    );
  });

  it("shows the portal and the self-host door to a subscriber, and no second checkout", async () => {
    listPlans.mockResolvedValue({ ok: true, value: { mode: "live", plans: [priced] } });
    readSubscription.mockResolvedValue({
      ok: true,
      value: { plan: "personal", status: "active", seats: 1, periodEnd: null },
    });
    render(<PlanPanel />);

    expect(await screen.findByTestId("plan-portal")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-card-personal")).not.toBeInTheDocument();
    // Running it yourself is still a reader's option after subscribing.
    expect(screen.getByTestId("plan-card-self-host")).toBeInTheDocument();
  });
});
