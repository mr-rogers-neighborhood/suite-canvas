import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { describeError, useDiagnosticsStore } from "../shell/diagnostics";
import { useDurabilityStore } from "../storage/durability";
import { resetAnnouncerForTests, useAnnouncerStore } from "./announcer";
import { LAST_ERROR_MESSAGE, QUOTA_MESSAGE, useFailureToasts } from "./failures";
import { HYDRATION_MESSAGE, reportHydrationFailure } from "./hydration";
import { useToastStore } from "./toast";

function FailureHost() {
  useFailureToasts();
  return null;
}

beforeEach(() => {
  useToastStore.getState().clear();
  resetAnnouncerForTests();
  useDurabilityStore.setState({ quota: null });
  useDiagnosticsStore.getState().clear();
});

describe("useFailureToasts", () => {
  it("should take a refused write out of the storage popover and into the toast layer", () => {
    render(<FailureHost />);

    act(() => {
      useDurabilityStore.getState().noteQuotaExceeded("Storage is full.");
    });

    const [only] = useToastStore.getState().toasts;
    expect(only).toMatchObject({
      tone: "failure",
      message: QUOTA_MESSAGE,
      detail: "Storage is full.",
      urgent: true,
    });
    // A refusal for space is a failure the person has to act on.
    expect(useAnnouncerStore.getState().assertive?.message).toContain(QUOTA_MESSAGE);
  });

  it("should offer the diagnostics bundle from the toast itself", () => {
    render(<FailureHost />);
    act(() => {
      useDurabilityStore.getState().noteQuotaExceeded("Storage is full.");
    });

    expect(useToastStore.getState().toasts[0]?.action?.label).toBe("Copy diagnostics");
  });

  it("should report the same refusal once, however many writes it breaks", () => {
    render(<FailureHost />);

    act(() => {
      useDurabilityStore.getState().noteQuotaExceeded("Storage is full.");
      useDurabilityStore.getState().noteQuotaExceeded("Storage is full.");
    });

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("should report an uncaught error as a failure with the error's own name", () => {
    render(<FailureHost />);

    act(() => {
      useDiagnosticsStore.getState().record(describeError(new TypeError("boom"), "/board"));
    });

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      tone: "failure",
      message: LAST_ERROR_MESSAGE,
      detail: "TypeError: boom",
    });
  });

  it("should not report a hydration failure as an anonymous uncaught error as well", () => {
    render(<FailureHost />);

    act(() => {
      reportHydrationFailure(new Error("could not open IndexedDB"));
    });

    const messages = useToastStore.getState().toasts.map((entry) => entry.message);
    expect(messages).toEqual([HYDRATION_MESSAGE]);
    expect(useToastStore.getState().toasts[0]?.detail).toContain("could not open IndexedDB");
  });
});

describe("reportHydrationFailure", () => {
  it("should say the local copy is gone, and that the workspace still opened", () => {
    reportHydrationFailure(new Error("corrupt snapshot"));

    const [only] = useToastStore.getState().toasts;
    expect(only?.message).toBe(HYDRATION_MESSAGE);
    expect(only?.detail).toContain("The workspace opened without it.");
    expect(useAnnouncerStore.getState().assertive?.message).toContain(HYDRATION_MESSAGE);
  });

  it("should leave a record the diagnostics bundle can carry", () => {
    reportHydrationFailure(new Error("corrupt snapshot"));

    expect(useDiagnosticsStore.getState().lastError).toMatchObject({
      name: "HydrationError",
      message: "corrupt snapshot",
    });
  });
});
