import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanPanel } from "./PlanPanel";

const ENTITLEMENT = {
  tier: "team",
  organizationId: "org-1",
  role: "owner",
  limits: { seats: 5, documentBytes: 2_147_483_648 },
  quota: [
    { id: "documentBytes", label: "Document storage", limit: 2_147_483_648, value: "2.0 GB" },
    { id: "seats", label: "Team members", limit: 5, value: "5" },
  ],
  refreshesAt: 1_700_000_000_000,
};

describe("the plan surface", () => {
  it("shows the tier the token carries and the limits that come with it", () => {
    render(<PlanPanel entitlement={ENTITLEMENT} />);
    expect(screen.getByTestId("plan-tier")).toHaveTextContent("team");
    expect(screen.getByTestId("plan-tier")).toHaveTextContent("as owner");
    expect(screen.getByTestId("plan-quota")).toHaveTextContent("Team members");
    expect(screen.getByTestId("plan-quota")).toHaveTextContent("2.0 GB");
  });

  it("says nothing is limited here rather than showing zeroes", () => {
    render(<PlanPanel entitlement={{ ...ENTITLEMENT, limits: {}, quota: [] }} />);
    expect(screen.getByTestId("plan-no-limits")).toHaveTextContent("sets no limits");
    expect(screen.queryByTestId("plan-quota")).not.toBeInTheDocument();
  });

  it("says the plan appears once signed in", () => {
    render(<PlanPanel entitlement={null} />);
    expect(screen.getByTestId("plan-tier")).toHaveTextContent("once you are signed in");
  });

  it("always offers the customer portal, which is where a plan is changed", () => {
    render(<PlanPanel entitlement={ENTITLEMENT} />);
    expect(screen.getByTestId("plan-portal")).toHaveTextContent("Manage billing in Stripe");
  });
});
