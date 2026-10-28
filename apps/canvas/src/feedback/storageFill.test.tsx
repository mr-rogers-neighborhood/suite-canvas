import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDurabilityStore } from "../storage/durability";
import { resetAnnouncerForTests, useAnnouncerStore } from "./announcer";
import {
  FILL_CRITICAL_MESSAGE,
  FILL_LOW_MESSAGE,
  fillCriticalDetail,
  fillLowDetail,
  useStorageFill,
} from "./storageFill";
import { useToastStore } from "./toast";

function FillHost() {
  useStorageFill();
  return null;
}

function setUsage(ratio: number): void {
  act(() => {
    useDurabilityStore.getState().setEstimate({ usage: ratio * 1000, quota: 1000 });
  });
}

beforeEach(() => {
  useToastStore.getState().clear();
  resetAnnouncerForTests();
  useDurabilityStore.setState({ estimate: { usage: null, quota: null }, quota: null });
});

describe("useStorageFill", () => {
  it("should say nothing while the origin has room", () => {
    render(<FillHost />);
    setUsage(0.2);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("should warn once when the browser starts to fill up", () => {
    render(<FillHost />);
    setUsage(0.75);

    const [only] = useToastStore.getState().toasts;
    expect(only).toMatchObject({
      tone: "neutral",
      message: FILL_LOW_MESSAGE,
      detail: fillLowDetail(75),
      action: { label: "Export a copy" },
    });
    // A filling disk is not news that interrupts a screen reader mid-sentence.
    expect(useAnnouncerStore.getState().assertive).toBeNull();
  });

  it("should not repeat itself while the share stays put", () => {
    render(<FillHost />);
    setUsage(0.75);
    setUsage(0.76);
    setUsage(0.8);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("should escalate to a failure the person has to act on", () => {
    render(<FillHost />);
    setUsage(0.75);
    act(() => {
      useToastStore.getState().clear();
    });
    setUsage(0.95);

    const [only] = useToastStore.getState().toasts;
    expect(only).toMatchObject({
      tone: "failure",
      message: FILL_CRITICAL_MESSAGE,
      detail: fillCriticalDetail(95),
      urgent: true,
    });
    expect(useAnnouncerStore.getState().assertive?.message).toContain(FILL_CRITICAL_MESSAGE);
  });

  it("should warn again after a cleanup, because that is a new crossing", () => {
    render(<FillHost />);
    setUsage(0.75);
    setUsage(0.1);
    act(() => {
      useToastStore.getState().clear();
    });
    setUsage(0.72);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]?.message).toBe(FILL_LOW_MESSAGE);
  });
});
