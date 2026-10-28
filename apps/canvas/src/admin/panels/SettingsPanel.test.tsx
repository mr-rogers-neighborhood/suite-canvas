import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";

/**
 * The panel's two jobs: say where a value came from, and make the one switch that changes
 * what the deployment *is* hard to hit by accident. The API is mocked, so this is about
 * what the screen promises.
 */
const rows = [
  {
    key: "billing.mode",
    group: "billing" as const,
    kind: "enum" as const,
    help: "Which Stripe credential set is active.",
    overridable: false,
    values: ["test", "live"],
    value: "test",
    source: "env" as const,
    env: "SUITE_BILLING_MODE",
  },
  {
    key: "billing.enabled",
    group: "billing" as const,
    kind: "boolean" as const,
    help: "Mount checkout at all.",
    overridable: false,
    value: false,
    source: "default" as const,
    env: "SUITE_BILLING_ENABLED",
    savedAt: 2000,
  },
  {
    key: "mail.smtp.password",
    group: "mail" as const,
    kind: "secret" as const,
    help: "Write-only.",
    overridable: false,
    value: "••••••••",
    source: "global" as const,
    env: "SUITE_SMTP_PASSWORD",
    savedAt: 500,
  },
];

const writeSetting = vi.fn(async () => {});
const sendTestMail = vi.fn(async () => ({ ok: true, transport: "smtp" }));

vi.mock("../api", () => ({
  errorText: (cause: unknown) => String(cause),
  listSettings: async () => ({ organizationId: null, bootedAt: 1000, settings: rows }),
  writeSetting: (...args: unknown[]) => writeSetting(...(args as [])),
  resetSetting: async () => {},
  sendTestMail: (...args: unknown[]) => sendTestMail(...(args as [])),
}));

afterEach(() => {
  cleanup();
  writeSetting.mockClear();
  sendTestMail.mockClear();
});

describe("the settings panel", () => {
  it("says which level supplied each value", async () => {
    render(<SettingsPanel />);

    await waitFor(() => expect(screen.getByTestId("setting-billing.mode")).toBeTruthy());
    expect(screen.getByText("from SUITE_BILLING_MODE")).toBeTruthy();
    expect(screen.getByText("built-in default")).toBeTruthy();
    expect(screen.getByText("set here")).toBeTruthy();
  });

  it("will not switch to live until the word is typed", async () => {
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByTestId("setting-billing.mode")).toBeTruthy());
    const row = screen.getByTestId("setting-billing.mode");

    fireEvent.click(
      row.querySelector('[data-testid="admin-button-live"]') ??
        row.querySelectorAll("button")[1] ??
        row,
    );
    expect(writeSetting).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Type live to confirm"), { target: { value: "live" } });
    const liveAgain = row.querySelectorAll("button")[1];
    if (liveAgain) fireEvent.click(liveAgain);

    await waitFor(() => expect(writeSetting).toHaveBeenCalledWith("billing.mode", "live"));
  });

  it("toggles a boolean without a confirmation", async () => {
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByTestId("setting-billing.enabled")).toBeTruthy());
    const row = screen.getByTestId("setting-billing.enabled");

    const toggle = row.querySelector("button");
    if (!toggle) throw new Error("no toggle");
    fireEvent.click(toggle);

    await waitFor(() => expect(writeSetting).toHaveBeenCalledWith("billing.enabled", true));
  });

  it("names the action on a switch, so a press cannot mean the opposite of its label", async () => {
    // The control used to be one button reading "On"/"Off", which is a *state*: an operator
    // who reads "Off" as "this is off, press to enable" was writing the same value back, and
    // one who read "On" as a confirmation turned billing off.
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByTestId("setting-billing.enabled")).toBeTruthy());
    const row = screen.getByTestId("setting-billing.enabled");

    expect(row.textContent).toContain("Turn on");
    expect(row.textContent).not.toContain("Turn off");
  });

  it("says which saved rows are not in force until a restart", async () => {
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByTestId("setting-billing.enabled")).toBeTruthy());

    // Written at 2000, process started at 1000: saved, and not yet read.
    expect(screen.getByTestId("restart-billing.enabled").textContent).toContain("Restart");
    // Written before the boot: already in force, so no marker.
    expect(screen.queryByTestId("restart-mail.smtp.password")).toBeNull();
  });

  it("offers a password field for a secret and no way to read it back", async () => {
    render(<SettingsPanel />);
    await waitFor(() => expect(screen.getByTestId("setting-mail.smtp.password")).toBeTruthy());
    const row = screen.getByTestId("setting-mail.smtp.password");
    const field = row.querySelector("input");

    expect(field?.getAttribute("type")).toBe("password");
    expect(field?.getAttribute("value")).not.toBe("hunter2");
  });

  it("warns while billing is live", async () => {
    const mode = rows[0] as { value: string };
    mode.value = "live";
    render(<SettingsPanel />);

    await waitFor(() => expect(screen.getByTestId("billing-live-warning")).toBeTruthy());
    expect(screen.getByTestId("billing-live-warning").textContent).toContain("live");
  });
});

describe("the mail test", () => {
  it("sends to the address typed and says which transport carried it", async () => {
    render(<SettingsPanel />);

    const field = await screen.findByLabelText("Test message recipient");
    fireEvent.change(field, { target: { value: "you@example.com" } });
    fireEvent.click(screen.getByText("Send"));

    await waitFor(() => expect(sendTestMail).toHaveBeenCalledWith("you@example.com"));
    expect((await screen.findByTestId("mail-test-result")).textContent).toContain("smtp transport");
  });

  it("will not send to nobody", async () => {
    render(<SettingsPanel />);

    const send = (await screen.findByText("Send")) as HTMLButtonElement;

    expect(send.disabled).toBe(true);
  });
});
