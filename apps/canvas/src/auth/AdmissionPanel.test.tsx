import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdmissionPanel } from "./AdmissionPanel";
import { ADMISSION_PENDING_MESSAGE } from "./admission";

describe("admission panel", () => {
  it("uses the server's sentence, word for word", () => {
    render(<AdmissionPanel onDismiss={() => {}} onSignOut={() => {}} />);
    expect(screen.getByTestId("admission-message")).toHaveTextContent(ADMISSION_PENDING_MESSAGE);
  });

  it("says what is waiting, in terms a person can act on", () => {
    render(<AdmissionPanel onDismiss={() => {}} onSignOut={() => {}} />);
    const panel = screen.getByTestId("admission-panel");
    expect(panel).toHaveTextContent("syncing this workspace");
    expect(panel).toHaveTextContent("sharing");
    expect(panel).toHaveTextContent("claimed by your account");
  });

  it("states that local work is untouched instead of behaving like a wall", () => {
    render(<AdmissionPanel onDismiss={() => {}} onSignOut={() => {}} />);
    expect(screen.getByTestId("admission-local")).toHaveTextContent(
      "Local editing, import and export are unaffected",
    );
  });

  it("hands the workspace back in one click", () => {
    const onDismiss = vi.fn();
    render(<AdmissionPanel onDismiss={onDismiss} onSignOut={() => {}} />);
    fireEvent.click(screen.getByTestId("admission-keep-working"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("offers an exit from the state, not just a message", () => {
    const onSignOut = vi.fn();
    render(<AdmissionPanel onDismiss={() => {}} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByTestId("admission-sign-out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
