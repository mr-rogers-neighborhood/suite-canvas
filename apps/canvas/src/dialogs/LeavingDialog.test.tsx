import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeavingDialog } from "./LeavingDialog";

/**
 * The leave interstitial (ADR-0025
 * amendment).
 *
 * This is the one moment a reader is told the work could disappear with the browser, so the test
 * holds the shape of that moment: one plain sentence, the two existing ways to make the work safe,
 * and a way out that really leaves.
 */

const INTERNAL_WORDS = ["evict", "eviction", "durable", "persist", "best-effort", "quota", "rung"];

function renderDialog(handlers: {
  onSignIn?: () => void;
  onLeave: () => void;
  onDismiss: () => void;
}) {
  return render(
    <LeavingDialog
      workspaceId="ws-1"
      title="A workspace"
      {...(handlers.onSignIn ? { onSignIn: handlers.onSignIn } : {})}
      onLeave={handlers.onLeave}
      onDismiss={handlers.onDismiss}
    />,
  );
}

describe("the leave interstitial", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("says the risk once, in words a reader uses, and offers both ways to be safe", () => {
    renderDialog({ onSignIn: vi.fn(), onLeave: vi.fn(), onDismiss: vi.fn() });

    const sentence = screen.getByTestId("leaving-sentence");
    expect(sentence).toHaveTextContent("saved only in this browser");
    expect(sentence).toHaveTextContent("may clear it");
    for (const word of INTERNAL_WORDS) {
      expect((sentence.textContent ?? "").toLowerCase()).not.toContain(word);
    }

    // The existing affordances, not new ones: the account dialog and the backup export.
    expect(screen.getByTestId("leaving-sign-in")).toHaveTextContent("Sign in");
    expect(screen.getByTestId("leaving-export")).toHaveTextContent("Export a copy");
    expect(screen.getByTestId("leaving-anyway")).toHaveTextContent("Leave anyway");
  });

  it("proceeds when the reader chooses to leave anyway", () => {
    const onLeave = vi.fn();
    const onDismiss = vi.fn();
    renderDialog({ onSignIn: vi.fn(), onLeave, onDismiss });

    fireEvent.click(screen.getByTestId("leaving-anyway"));

    // Dismissing is what stops the next return to the launcher from asking again.
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("hands over to the account dialog and steps aside", () => {
    const onSignIn = vi.fn();
    const onDismiss = vi.fn();
    renderDialog({ onSignIn, onLeave: vi.fn(), onDismiss });

    fireEvent.click(screen.getByTestId("leaving-sign-in"));

    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("treats Escape as staying, and remembers the answer", () => {
    const onDismiss = vi.fn();
    renderDialog({ onSignIn: vi.fn(), onLeave: vi.fn(), onDismiss });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has no sign-in to offer in a build without accounts", () => {
    renderDialog({ onLeave: vi.fn(), onDismiss: vi.fn() });

    expect(screen.queryByTestId("leaving-sign-in")).not.toBeInTheDocument();
    expect(screen.getByTestId("leaving-export")).toBeInTheDocument();
  });
});
