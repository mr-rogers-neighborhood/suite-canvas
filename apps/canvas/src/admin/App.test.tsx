import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

/**
 * The panel's navigation, in four groups.
 *
 * The property that matters is that no view becomes unreachable: a group is a door to its
 * first view, and the sub-row is how the others are reached. The gate and the panels are
 * stubbed, so this is only about the doors.
 */
vi.mock("../auth/client", () => ({ signOut: async () => {} }));

vi.mock("./api", () => ({
  errorText: (cause: unknown) => String(cause),
  getStatus: async () => ({ ok: true }),
  readRoleOverride: async () => ({ role: null, organizationId: null, setAt: null, realRole: null }),
  stopRole: async () => ({ role: null, organizationId: null, setAt: null, realRole: null }),
}));

/** Every panel says its own name, which is all this test needs from it. */
vi.mock("./panels/StatusPanel", () => ({ StatusPanel: () => <div>panel:status</div> }));
vi.mock("./panels/SettingsPanel", () => ({ SettingsPanel: () => <div>panel:settings</div> }));
vi.mock("./panels/SupportPanel", () => ({ SupportPanel: () => <div>panel:support</div> }));
vi.mock("./panels/AccountsPanel", () => ({ AccountsPanel: () => <div>panel:accounts</div> }));
vi.mock("./panels/ActivityPanel", () => ({ ActivityPanel: () => <div>panel:activity</div> }));
vi.mock("./panels/WorkspacesPanel", () => ({
  WorkspacesPanel: () => <div>panel:workspaces</div>,
}));
vi.mock("./panels/RoomsPanel", () => ({ RoomsPanel: () => <div>panel:rooms</div> }));
vi.mock("./panels/SharesPanel", () => ({ SharesPanel: () => <div>panel:shares</div> }));
vi.mock("./panels/TemplatesPanel", () => ({ TemplatesPanel: () => <div>panel:templates</div> }));
vi.mock("./panels/FixturesPanel", () => ({ FixturesPanel: () => <div>panel:fixtures</div> }));

afterEach(cleanup);

async function open(): Promise<void> {
  render(<App />);
  // The gate admits on the first status read, then the panel renders.
  await screen.findByTestId("admin-group-deployment");
}

describe("the grouped panel", () => {
  it("opens on Status, inside the deployment group", async () => {
    await open();

    expect(screen.getByText("panel:status")).toBeTruthy();
    expect(screen.getByTestId("admin-group-deployment").getAttribute("aria-selected")).toBe("true");
  });

  it("keeps all ten views reachable through their groups", async () => {
    await open();

    const reachable: Record<string, string> = {
      deployment: "status",
      people: "accounts",
      workspaces: "workspaces",
      content: "templates",
    };
    for (const [group, first] of Object.entries(reachable)) {
      fireEvent.click(screen.getByTestId(`admin-group-${group}`));
      expect(await screen.findByText(`panel:${first}`)).toBeTruthy();
    }
  });

  it("moves inside a group without changing the group", async () => {
    await open();
    fireEvent.click(screen.getByTestId("admin-group-people"));

    fireEvent.click(screen.getByTestId("admin-view-activity"));

    expect(await screen.findByText("panel:activity")).toBeTruthy();
    // The group stays selected, which is what makes the two-row nav readable.
    expect(screen.getByTestId("admin-group-people").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("admin-view-activity").getAttribute("aria-current")).toBe("page");
  });

  it("shows only the views of the group you are in", async () => {
    await open();

    // Status is in this deployment; Rooms is not, and would be a second level of noise.
    expect(screen.getByTestId("admin-view-status")).toBeTruthy();
    expect(screen.queryByTestId("admin-view-rooms")).toBeNull();
  });
});
