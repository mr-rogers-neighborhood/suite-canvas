import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DevicesPanel } from "./DevicesPanel";

const CURRENT = {
  id: "session-current",
  createdAt: 1_000,
  updatedAt: 2_000,
  expiresAt: 3_000,
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  ipAddress: "203.0.113.9",
  current: true,
};

const OTHER = {
  ...CURRENT,
  id: "session-other",
  current: false,
  userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
};

function api(overrides: Partial<Parameters<typeof DevicesPanel>[0]["api"] & object> = {}) {
  return {
    listDevices: vi.fn(async () => ({ ok: true as const, value: [CURRENT, OTHER] })),
    revokeDevice: vi.fn(async () => ({ ok: true as const, value: true as const })),
    revokeOtherDevices: vi.fn(async () => ({ ok: true as const, value: true as const })),
    ...overrides,
  };
}

describe("devices and sessions", () => {
  it("names each browser and marks the one in use", async () => {
    render(<DevicesPanel api={api()} />);

    expect(await screen.findByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText("Firefox on Linux")).toBeInTheDocument();
    expect(screen.getByTestId("device-current")).toHaveTextContent("this device");
  });

  it("cannot revoke the session that is reading the list", async () => {
    render(<DevicesPanel api={api()} />);
    await screen.findByText("Chrome on macOS");
    expect(screen.getByTestId(`device-revoke-${CURRENT.id}`)).toBeDisabled();
  });

  it("revokes one device and says what happens next", async () => {
    const client = api();
    render(<DevicesPanel api={client} />);
    await screen.findByText("Firefox on Linux");

    fireEvent.click(screen.getByTestId(`device-revoke-${OTHER.id}`));

    await waitFor(() => expect(client.revokeDevice).toHaveBeenCalledWith(OTHER.id));
    expect(await screen.findByTestId("devices-notice")).toHaveTextContent("within five minutes");
  });

  it("signs out every other device in one press", async () => {
    const client = api();
    render(<DevicesPanel api={client} />);
    await screen.findByText("Firefox on Linux");

    fireEvent.click(screen.getByTestId("devices-revoke-others"));
    await waitFor(() => expect(client.revokeOtherDevices).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("devices-notice")).toHaveTextContent("This one stays");
  });

  it("reports a refusal instead of pretending the device went away", async () => {
    const client = api({
      revokeDevice: vi.fn(async () => ({
        ok: false as const,
        message: "That device could not be signed out.",
      })),
    });
    render(<DevicesPanel api={client} />);
    await screen.findByText("Firefox on Linux");

    fireEvent.click(screen.getByTestId(`device-revoke-${OTHER.id}`));
    expect(await screen.findByTestId("devices-error")).toHaveTextContent("could not be signed out");
  });
});
