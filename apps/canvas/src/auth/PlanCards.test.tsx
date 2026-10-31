import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BillingPlan } from "./billing";
import { allowancesOf, PlanCard, SelfHostCard } from "./PlanCards";

const PERSONAL_PLAN: BillingPlan = {
  name: "personal",
  priceId: "price_1",
  limits: {
    workspaces: 2_147_483_647,
    documentBytes: 268_435_456,
    attachmentBytes: 10_737_418_240,
    seats: 5,
  },
  price: {
    amount: 1200,
    currency: "usd",
    interval: "month",
  },
};

describe("PlanCards allowances and usage display", () => {
  it("formats allowances without usage as plan totals", () => {
    const allowances = allowancesOf(PERSONAL_PLAN);
    const doc = allowances.find((a) => a.id === "documentBytes");
    const attach = allowances.find((a) => a.id === "attachmentBytes");
    expect(doc?.value).toBe("256 MB");
    expect(attach?.value).toBe("10 GB");
  });

  it("formats allowances with usage as used / total", () => {
    const allowances = allowancesOf(PERSONAL_PLAN, {
      attachmentBytes: 15_728_640, // 15 MB
      documentBytes: 2_097_152, // 2 MB
    });
    const doc = allowances.find((a) => a.id === "documentBytes");
    const attach = allowances.find((a) => a.id === "attachmentBytes");
    expect(doc?.value).toBe("2.0 MB / 256 MB");
    expect(attach?.value).toBe("15 MB / 10 GB");
  });

  it("renders usage in PlanCard dd", () => {
    render(
      <PlanCard
        plan={PERSONAL_PLAN}
        busy={false}
        onChoose={() => {}}
        currentUsage={{ attachmentBytes: 52_428_800 }} // 50 MB
      />,
    );
    const attachAllowance = screen.getByTestId("plan-allowance-personal-attachmentBytes");
    expect(attachAllowance.textContent).toBe("50 MB / 10 GB");
  });

  it("renders current media usage on SelfHostCard", () => {
    render(<SelfHostCard currentUsage={{ attachmentBytes: 104_857_600 }} />);
    expect(screen.getByText(/Current media usage: 100 MB \/ Unlimited/)).toBeDefined();
  });
});
