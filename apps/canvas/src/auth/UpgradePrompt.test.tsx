import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { UpgradePrompt } from "./UpgradePrompt";
import { useAccountStore } from "./useAccountStore";

beforeEach(() => {
  useAccountStore.getState().clear();
});

describe("the upgrade prompt", () => {
  it("renders nothing until a refusal says the plan is the obstacle", () => {
    render(<UpgradePrompt />);
    expect(screen.queryByTestId("upgrade-prompt")).not.toBeInTheDocument();
  });

  it("carries the refusal's own sentence, and the promise that nothing was lost", () => {
    useAccountStore.getState().noteUpgrade({
      code: "workspace-limit",
      message: "This plan's workspaces are all in use.",
    });
    render(<UpgradePrompt />);

    expect(screen.getByTestId("upgrade-prompt")).toHaveAttribute("data-code", "workspace-limit");
    expect(screen.getByTestId("upgrade-message")).toHaveTextContent("all in use");
    expect(screen.getByTestId("upgrade-prompt")).toHaveTextContent("Nothing you made was deleted");
  });

  it("offers the plan surface rather than a checkout of its own", () => {
    useAccountStore.getState().noteUpgrade({ code: "seat-refused", message: "No seat." });
    render(<UpgradePrompt />);

    fireEvent.click(screen.getByTestId("upgrade-see-plans"));
    expect(useAccountStore.getState().panelOpen).toBe(true);
    expect(useAccountStore.getState().panelTab).toBe("plan");
    expect(useAccountStore.getState().upgrade).toBeNull();
  });

  it("goes away on request and leaves the work alone", () => {
    useAccountStore.getState().noteUpgrade({ code: "seat-refused", message: "No seat." });
    render(<UpgradePrompt />);
    fireEvent.click(screen.getByTestId("upgrade-dismiss"));
    expect(useAccountStore.getState().upgrade).toBeNull();
    expect(useAccountStore.getState().panelOpen).toBe(false);
  });
});
