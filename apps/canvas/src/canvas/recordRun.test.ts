import { beforeEach, describe, expect, it } from "vitest";
import { isRecording, planRecordClick, useRecordRunStore } from "./recordRun";

/**
 * Recording reuses the step verbs instead of inventing a canvas language
 * (ADR-0058 amendment). These tests pin what a click means, because the difference
 * between "a step per click" and "one step with many targets" is the whole point of
 * the verbs being there.
 */

const store = () => useRecordRunStore.getState();

beforeEach(() => {
  useRecordRunStore.setState({ tutorialId: null, steps: 0 });
});

describe("planRecordClick", () => {
  it("appends a step per click in place and in thread", () => {
    expect(planRecordClick("place", 0)).toEqual({ action: "newStep", stepIndex: 0 });
    expect(planRecordClick("thread", 3)).toEqual({ action: "newStep", stepIndex: 3 });
  });

  it("grows one step when webbing, because a step holds several targets", () => {
    expect(planRecordClick("fan", 1)).toEqual({ action: "addTarget", stepIndex: 0 });
    expect(planRecordClick("fan", 4)).toEqual({ action: "addTarget", stepIndex: 3 });
  });

  it("starts a step when webbing has nothing to grow yet", () => {
    expect(planRecordClick("fan", 0)).toEqual({ action: "newStep", stepIndex: 0 });
  });

  it("grows the current step on a fan, and starts a new one on a thread", () => {
    // A fan adds a target to the step being written; it does not begin another.
    expect(planRecordClick("fan", 2)).toEqual({ action: "addTarget", stepIndex: 1 });
  });
});

describe("the recording store", () => {
  it("counts steps, and an accumulated target is not a new step", () => {
    store().start("tutorial-1");
    store().captured(planRecordClick("thread", 0));
    store().captured(planRecordClick("thread", 1));
    expect(store().steps).toBe(2);

    // A fan click joins the step it is on, so the count stands still.
    store().captured(planRecordClick("fan", 2));
    expect(store().steps).toBe(2);
  });

  it("reports when a recording is live, so the cursor and the control agree", () => {
    expect(isRecording()).toBe(false);
    store().start("tutorial-1");
    expect(isRecording()).toBe(true);
    store().stop();
    expect(isRecording()).toBe(false);
  });

  it("keeps the last count after a stop, so the summary can be shown", () => {
    store().start("tutorial-1");
    store().captured(planRecordClick("place", 0));
    store().stop();

    expect(store().tutorialId).toBeNull();
    expect(store().steps).toBe(1);
  });

  it("is a no-op when stopping nothing, so a stray exit cannot clobber a count", () => {
    useRecordRunStore.setState({ tutorialId: null, steps: 7 });
    store().stop();

    expect(store().steps).toBe(7);
  });
});
