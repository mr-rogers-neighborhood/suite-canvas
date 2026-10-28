import { listTourSteps, WorkspaceDocument } from "@suite/graph";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureTutorialType } from "../cards/tour";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useRecordRunStore } from "./recordRun";
import { useRecordEngine } from "./useRecordEngine";

/**
 * Recording is a purpose whose clicks *write* (ADR-0064 §9): one click is one
 * step, and the step verbs decide whether it starts a step or grows one. These
 * tests pin the writes, because a recorder that quietly drew links, or restarted
 * the tour it was pointed at, would look identical in the control.
 */

function fixture() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  const tutorial = workspace.createCard({
    typeId: ensureTutorialType(workspace).id,
    boardId: board.id,
    position: { x: 0, y: 0 },
  });
  const first = workspace.createCard({
    typeId: "note",
    boardId: board.id,
    position: { x: 400, y: 0 },
  });
  const second = workspace.createCard({
    typeId: "note",
    boardId: board.id,
    position: { x: 800, y: 0 },
  });
  useCanvasStore.setState({ workspace });
  useUiStore.setState({
    activeBoardId: board.id,
    mode: "place",
    // The camera a recorded step keeps: what the author was looking at.
    boardViewports: { [board.id]: { x: -120, y: 40, zoom: 0.75 } },
  });
  return { workspace, tutorial, first, second };
}

const stepsOf = (workspace: WorkspaceDocument, tutorialId: string) =>
  listTourSteps(workspace, tutorialId);

beforeEach(() => {
  useRecordRunStore.setState({ tutorialId: null, steps: 0 });
});

describe("the record engine", () => {
  it("writes one step per click, with the target and the camera it was recorded in", () => {
    const { workspace, tutorial, first } = fixture();
    const { result } = renderHook(() => useRecordEngine());

    act(() => result.current.start(tutorial.id));
    act(() => result.current.record({ kind: "card", id: first.id }));

    const steps = stepsOf(workspace, tutorial.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.step?.targets).toEqual([{ kind: "card", id: first.id }]);
    expect(steps[0]?.step?.viewport).toEqual({ x: -120, y: 40, zoom: 0.75 });
    expect(result.current.state).toEqual({ tutorialId: tutorial.id, steps: 1 });
    expect(result.current.held).toBe(1);
  });

  it("does nothing while nothing is being recorded", () => {
    const { workspace, tutorial, first } = fixture();
    const { result } = renderHook(() => useRecordEngine());

    act(() => result.current.record({ kind: "card", id: first.id }));

    expect(stepsOf(workspace, tutorial.id)).toHaveLength(0);
    expect(result.current.held).toBeNull();
  });

  it("appends a target to the step being written when webbing", () => {
    const { workspace, tutorial, first, second } = fixture();
    const { result } = renderHook(() => useRecordEngine());

    act(() => {
      useUiStore.setState({ mode: "fan" });
      result.current.start(tutorial.id);
    });
    act(() => result.current.record({ kind: "card", id: first.id }));
    act(() => result.current.record({ kind: "card", id: second.id }));

    const steps = stepsOf(workspace, tutorial.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.step?.targets).toEqual([
      { kind: "card", id: first.id },
      { kind: "card", id: second.id },
    ]);
    // The step grew, so the run still holds it: the next click joins it too.
    expect(result.current.state.steps).toBe(1);
    expect(result.current.held).toBe(0);
  });

  it("starts a step when webbing has nothing to grow yet", () => {
    const { workspace, tutorial, first } = fixture();
    const { result } = renderHook(() => useRecordEngine());

    act(() => {
      useUiStore.setState({ mode: "fan" });
      result.current.start(tutorial.id);
    });
    act(() => result.current.record({ kind: "card", id: first.id }));

    expect(stepsOf(workspace, tutorial.id)).toHaveLength(1);
    expect(result.current.held).toBe(0);
  });

  it("starts a new step per click in thread mode, because a thread is a sequence", () => {
    const { workspace, tutorial, first, second } = fixture();
    const { result } = renderHook(() => useRecordEngine());

    act(() => {
      useUiStore.setState({ mode: "thread" });
      result.current.start(tutorial.id);
    });
    act(() => result.current.record({ kind: "card", id: first.id }));
    act(() => result.current.record({ kind: "card", id: second.id }));

    expect(stepsOf(workspace, tutorial.id)).toHaveLength(2);
    expect(result.current.held).toBe(2);
  });

  it("continues the tour it is re-armed on, and a stop keeps the steps written", () => {
    const { workspace, tutorial, first, second } = fixture();
    const { result } = renderHook(() => useRecordEngine());

    act(() => {
      result.current.start(tutorial.id);
      result.current.record({ kind: "card", id: first.id });
      result.current.stop();
    });
    expect(result.current.held).toBeNull();

    act(() => result.current.start(tutorial.id));
    act(() => result.current.record({ kind: "card", id: second.id }));

    // Two steps in one timeline: re-entering `record` does not start over.
    expect(stepsOf(workspace, tutorial.id)).toHaveLength(2);
    expect(result.current.state.steps).toBe(2);
  });

  it("does not double a target the step already points at", () => {
    const { workspace, tutorial, first } = fixture();
    const { result } = renderHook(() => useRecordEngine());

    act(() => {
      useUiStore.setState({ mode: "fan" });
      result.current.start(tutorial.id);
    });
    act(() => result.current.record({ kind: "card", id: first.id }));
    act(() => result.current.record({ kind: "card", id: first.id }));

    const steps = stepsOf(workspace, tutorial.id);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.step?.targets).toEqual([{ kind: "card", id: first.id }]);
  });
});
