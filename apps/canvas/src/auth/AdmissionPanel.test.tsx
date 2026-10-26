import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdmissionPanel } from "./AdmissionPanel";

/**
 * The panel declared `aria-modal="true"` and behaved like a poster: focus stayed
 * on the page behind it, Tab walked into the canvas, and Escape did nothing.
 */
describe("the admission panel", () => {
  it("starts on the answer it recommends", () => {
    render(<AdmissionPanel onDismiss={() => {}} onSignOut={() => {}} />);

    expect(screen.getByTestId("admission-keep-working")).toHaveFocus();
  });

  it("closes on Escape", () => {
    const onDismiss = vi.fn();
    render(<AdmissionPanel onDismiss={onDismiss} onSignOut={() => {}} />);

    fireEvent.keyDown(screen.getByTestId("admission-panel"), { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("wraps Tab from the last control back to the first", () => {
    render(<AdmissionPanel onDismiss={() => {}} onSignOut={() => {}} />);
    const last = screen.getByTestId("admission-keep-working");
    last.focus();

    fireEvent.keyDown(last, { key: "Tab" });

    expect(screen.getByTestId("admission-sign-out")).toHaveFocus();
  });
});
