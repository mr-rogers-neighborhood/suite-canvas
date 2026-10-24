import type { Board } from "@suite/graph";
import type { CanvasEngine, Entity } from "@vibecook/ice";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type BoardReseedInput, reseedBoardTree } from "./iceBoardReseed";
import type { BoardMat, SeedReport } from "./iceSurfaceSpawns";

/**
 * A rebuild is the one desk operation that has an *order*: the reader leaves
 * the frame before its mat is deleted, and is put back only once the new mats
 * exist. Everything here is a seam, so the order is what the test asserts.
 */

/** The frame ICE's nav stack is standing in; `currentNavFrame` reads it. */
const nav = vi.hoisted(() => ({ frame: undefined as number | undefined }));

vi.mock("@vibecook/ice", () => ({
  currentNavFrame: () => nav.frame as unknown as Entity | undefined,
}));

const ROOT = "view";
const VIEW = { width: 2000, height: 2000 };

function board(id: string, parentBoardId: string = ROOT): Board {
  return {
    id,
    name: id.toUpperCase(),
    rect: { x: 0, y: 0, ...VIEW },
    z: 0,
    parentBoardId,
    createdAt: 0,
    updatedAt: 0,
  };
}

function entity(id: number): Entity {
  return id as unknown as Entity;
}

/** The mats on the desk, parented as the tree says. */
function matsOf(entries: readonly [number, string, string][]): Map<Entity, BoardMat> {
  return new Map(
    entries.map(([id, boardId, parentBoardId]) => [
      entity(id),
      { boardId, parentBoardId, title: boardId.toUpperCase() },
    ]),
  );
}

function seedOf(mats: Map<Entity, BoardMat>): SeedReport {
  return {
    mode: "workspace",
    label: "Workspace",
    seeded: mats.size,
    total: mats.size,
    kinds: [],
    failures: [],
    entities: [...mats.keys()],
    entitySlots: new Map(),
    boardMats: mats,
    stubs: 0,
    pinEntities: new Map(),
    boards: mats.size,
    skipped: [],
  };
}

interface Desk {
  readonly input: BoardReseedInput;
  readonly events: string[];
  readonly replace: ReturnType<typeof vi.fn>;
  readonly writeCamera: ReturnType<typeof vi.fn>;
  readonly exitTo: ReturnType<typeof vi.fn>;
  readonly enterContainer: ReturnType<typeof vi.fn>;
}

/**
 * A desk whose nav stack is the state under test: `enterContainer` pushes the
 * frame, `exitTo` pops to a depth, and both are recorded in one ordered list
 * with the replacement itself.
 */
function desk(options: {
  readonly standing: readonly [number, string, string][] | null;
  readonly next: readonly [number, string, string][] | null;
  readonly boards: readonly Board[];
}): Desk {
  const events: string[] = [];
  let depth = options.standing === null ? 0 : options.standing.length;
  const standing =
    options.standing === null ? new Map<Entity, BoardMat>() : matsOf(options.standing);
  nav.frame = options.standing === null ? undefined : options.standing.at(-1)?.[0];

  const exitTo = vi.fn((target: number) => {
    events.push(`exit:${target}`);
    depth = target;
    nav.frame = undefined;
  });
  const enterContainer = vi.fn((container: Entity) => {
    events.push(`enter:${String(container)}`);
    depth += 1;
    nav.frame = container as unknown as number;
  });
  const replace = vi.fn(() => {
    events.push("replace");
    return options.next === null ? null : seedOf(matsOf(options.next));
  });
  const writeCamera = vi.fn(() => {
    events.push("camera");
  });

  const engine = {
    nav: { depth: () => depth },
    ops: { exitTo, enterContainer },
    world: {},
  } as unknown as CanvasEngine;

  return {
    input: {
      engine,
      boards: options.boards,
      rootBoardId: ROOT,
      mats: standing,
      replace,
      readCamera: () => ({ x: 12, y: 34, zoom: 0.5 }),
      writeCamera,
    },
    events,
    replace,
    writeCamera,
    exitTo,
    enterContainer,
  };
}

beforeEach(() => {
  nav.frame = undefined;
});

describe("reseedBoardTree", () => {
  it("should replace the contents once, after leaving the frame it was standing in", () => {
    const subject = desk({
      standing: [[51, "a", ROOT]],
      next: [[52, "a", ROOT]],
      boards: [board("a")],
    });

    const report = reseedBoardTree(subject.input);

    expect(subject.replace).toHaveBeenCalledTimes(1);
    expect(report.exited).toBe(0);
    // The pop comes before the drop: the mat the reader is inside is one of the
    // entities the replacement deletes.
    expect(subject.events).toEqual(["exit:0", "replace", "enter:52", "camera"]);
  });

  it("should put the reader back in the Board they were in", () => {
    const subject = desk({
      standing: [[51, "a", ROOT]],
      next: [[52, "a", ROOT]],
      boards: [board("a")],
    });

    const report = reseedBoardTree(subject.input);

    expect(report.path).toEqual(["a"]);
    expect(report.cameraRestored).toBe(true);
    expect(subject.writeCamera).toHaveBeenCalledWith({ x: 12, y: 34, zoom: 0.5 });
    expect(subject.enterContainer).toHaveBeenCalledWith(entity(52), { transition: "none" });
  });

  it("should restore a two-level path outermost first", () => {
    const subject = desk({
      standing: [
        [51, "a", ROOT],
        [52, "b", "a"],
      ],
      next: [
        [61, "a", ROOT],
        [62, "b", "a"],
      ],
      boards: [board("a"), board("b", "a")],
    });

    const report = reseedBoardTree(subject.input);

    expect(report.path).toEqual(["a", "b"]);
    expect(subject.events).toEqual(["exit:0", "replace", "enter:61", "enter:62", "camera"]);
  });

  it("should exit to the nearest surviving ancestor when the entered Board is gone", () => {
    const subject = desk({
      standing: [
        [51, "a", ROOT],
        [52, "b", "a"],
      ],
      next: [[61, "a", ROOT]],
      boards: [board("a")],
    });

    const report = reseedBoardTree(subject.input);

    expect(report.path).toEqual(["a"]);
    expect(report.exited).toBe(1);
    // The camera was read inside `b`, which no longer exists: writing it into
    // `a` would frame the wrong place, so the arrival framing stands.
    expect(report.cameraRestored).toBe(false);
    expect(subject.writeCamera).not.toHaveBeenCalled();
    expect(subject.enterContainer).toHaveBeenCalledTimes(1);
  });

  it("should leave the reader on the plane when every entered Board is gone", () => {
    const subject = desk({
      standing: [[51, "a", ROOT]],
      next: [],
      boards: [],
    });

    const report = reseedBoardTree(subject.input);

    expect(report.path).toEqual([]);
    expect(report.exited).toBe(1);
    expect(subject.enterContainer).not.toHaveBeenCalled();
    expect(subject.writeCamera).not.toHaveBeenCalled();
  });

  it("should do nothing else when the replacement did not happen", () => {
    const subject = desk({
      standing: [[51, "a", ROOT]],
      next: null,
      boards: [board("a")],
    });

    const report = reseedBoardTree(subject.input);

    expect(report.seed).toBeNull();
    expect(report.cameraRestored).toBe(false);
    expect(subject.events).toEqual(["exit:0", "replace"]);
  });
});
