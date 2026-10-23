import {
  type Board,
  type Card,
  type GraphEdge,
  type Placement,
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  type Section,
} from "@suite/graph";
import { describe, expect, it, vi } from "vitest";
import {
  buildInstanceIdentityMap,
  type InstanceIdentityMap,
  type PortalContainerSpawnStep,
  type PortalSpawnOptions,
  type PortalSpawnPlan,
  type PortalSpawnStep,
  type PortalStubSpawnStep,
  planPortalSpawns,
  portalFocusTarget,
  spawnIcePortals,
  spawnReportEntities,
} from "./icePortalSpawn";
import { ICE_CARD_SIZE, type IcePortalSource, planIcePortals } from "./icePortals";

const NOTE_TYPE_ID = "note";

const KINDS = {
  board: "suite.board",
  section: "suite.section",
  edge: "suite.edge",
  stub: "suite.stub",
} as const;

/** `noUncheckedIndexedAccess` is on: a missing fixture row is a test bug. */
function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`Expected an item at index ${index}.`);
  return value;
}

function board(id: string, name: string): Board {
  return { id, name, createdAt: 0, updatedAt: 0 };
}

function noteCard(id: string, connectors: readonly { id: string; x: number; y: number }[] = []) {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    connectors: [...connectors],
    typeIds: [NOTE_TYPE_ID],
    primaryTypeId: NOTE_TYPE_ID,
    tags: [],
    properties: {},
  } satisfies Card;
}

function portalCard(id: string, target: string): Card {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    connectors: [],
    typeIds: [PORTAL_TYPE_ID],
    primaryTypeId: PORTAL_TYPE_ID,
    tags: [],
    properties: { [PORTAL_BOARD_FIELD_ID]: target },
  };
}

function place(
  boardId: string,
  cardId: string,
  x: number,
  y: number,
  z: number,
  size?: { width: number; height: number },
): Placement {
  return {
    boardId,
    cardId,
    x,
    y,
    z,
    createdAt: 0,
    ...(size === undefined ? {} : { width: size.width, height: size.height }),
  };
}

function section(id: string, boardId: string, z: number, title: string): Section {
  return {
    id,
    boardId,
    title,
    x: 0,
    y: 0,
    width: 700,
    height: 520,
    z,
    createdAt: 0,
    updatedAt: 0,
  };
}

function edge(
  id: string,
  boardId: string,
  source: string,
  target: string,
  label?: string,
): GraphEdge {
  return {
    id,
    boardId,
    source,
    target,
    kind: "relates-to",
    path: "bezier",
    bidirectional: false,
    createdAt: 0,
    updatedAt: 0,
    ...(label === undefined ? {} : { label }),
  };
}

/**
 * Root -> two portals to Alpha -> Alpha's own portal to Beta, plus a portal
 * back to the root (a cycle) and one to a board the snapshot does not contain.
 */
function exampleSource(): IcePortalSource {
  return {
    boards: [
      board("board-root", "Root"),
      board("board-alpha", "Alpha"),
      board("board-beta", "Beta"),
    ],
    cards: [
      noteCard("note-root-1", [{ id: "east", x: 1, y: 0.5 }]),
      noteCard("note-root-2"),
      portalCard("portal-alpha-1", "board-alpha"),
      portalCard("portal-alpha-2", "board-alpha"),
      portalCard("portal-missing", "board-ghost"),
      noteCard("note-alpha-1", [{ id: "east", x: 1, y: 0.5 }]),
      noteCard("note-alpha-2"),
      portalCard("portal-beta", "board-beta"),
      portalCard("portal-loop", "board-root"),
      noteCard("note-beta"),
    ],
    placements: [
      place("board-root", "note-root-1", 0, 0, 0),
      place("board-root", "note-root-2", 400, 0, 1),
      place("board-root", "portal-alpha-1", 0, 300, 2, { width: 300, height: 260 }),
      place("board-root", "portal-alpha-2", 360, 300, 3, { width: 300, height: 260 }),
      place("board-root", "portal-missing", 720, 300, 4),
      place("board-alpha", "note-alpha-1", 0, 0, 0),
      place("board-alpha", "note-alpha-2", 400, 0, 1),
      place("board-alpha", "portal-beta", 0, 300, 2, { width: 300, height: 260 }),
      place("board-alpha", "portal-loop", 360, 300, 3),
      place("board-beta", "note-beta", 0, 0, 0),
    ],
    sections: [
      section("section-root", "board-root", 2, "Root region"),
      section("section-alpha", "board-alpha", 1, "Alpha region"),
    ],
    edges: [
      edge("edge-root", "board-root", "note-root-1", "note-root-2"),
      edge("edge-alpha", "board-alpha", "note-alpha-1", "note-alpha-2", "Alpha link"),
    ],
  };
}

function containers(plan: PortalSpawnPlan): readonly PortalContainerSpawnStep[] {
  const result: PortalContainerSpawnStep[] = [];
  for (const step of plan.steps) {
    if (step.kind === "container") result.push(step);
  }
  return result;
}

function stubSteps(plan: PortalSpawnPlan, reason?: PortalStubSpawnStep["reason"]) {
  return plan.steps.filter(
    (step): step is PortalStubSpawnStep =>
      step.kind === "stub" && (reason === undefined || step.reason === reason),
  );
}

function indexOfStep(plan: PortalSpawnPlan, step: PortalSpawnStep): number {
  return plan.steps.indexOf(step);
}

function descriptorsOf(plan: PortalSpawnPlan, instanceKey: string): readonly PortalSpawnStep[] {
  return plan.steps.filter((step) => step.kind !== "container" && step.instanceKey === instanceKey);
}

/** Root-only workspace: one board, one plain card, no portals. */
function soloPlan(): PortalSpawnPlan {
  const ice = planIcePortals(
    {
      boards: [board("solo", "Solo")],
      cards: [noteCard("note")],
      placements: [place("solo", "note", 12, 34, 0)],
    },
    "solo",
  );
  return planPortalSpawns(ice);
}

interface FakeEntity {
  readonly id: number;
  readonly type: string;
}

function recorder(
  options: { readonly fail?: (type: string, opts: PortalSpawnOptions<FakeEntity>) => boolean } = {},
) {
  let next = 0;
  const calls: { type: string; opts: PortalSpawnOptions<FakeEntity> }[] = [];
  const project = vi.fn();
  const spawn = vi.fn((type: string, opts: PortalSpawnOptions<FakeEntity>) => {
    if (options.fail?.(type, opts) === true) throw new Error(`refused ${type}`);
    next += 1;
    const entity: FakeEntity = { id: next, type };
    calls.push({ type, opts });
    return entity;
  });
  return { calls, project, spawn };
}

describe("planPortalSpawns", () => {
  it("should plan a single root container and nothing else for a root-only board", () => {
    const plan = soloPlan();

    expect(plan.steps.map((step) => step.kind)).toEqual(["container"]);
    expect(plan.counts).toEqual({ containers: 1, sections: 0, edges: 0, stubs: 0 });
    expect(plan.rootKey).toBe("b:solo");
    expect(plan.rootBoardId).toBe("solo");

    expect(at(plan.steps, 0)).toMatchObject({
      kind: "container",
      key: "b:solo",
      instanceKey: "b:solo",
      boardId: "solo",
      boardName: "Solo",
      depth: 0,
      parentKey: null,
      portalCardId: null,
      placementId: null,
      path: ["solo"],
    });
    const root = at(plan.steps, 0);
    expect(root.box).toEqual({
      x: 12,
      y: 34,
      w: ICE_CARD_SIZE.width,
      h: ICE_CARD_SIZE.height,
    });
    expect(plan.identities.cardInstances("note")).toEqual([]);
    expect(plan.identities.instancesOfBoard("solo")).toHaveLength(1);

    const engine = recorder();
    const report = spawnIcePortals(plan, engine, KINDS);
    expect(report.seeded).toBe(1);
    expect(report.failures).toEqual([]);
    expect(report.kinds).toEqual([KINDS.board]);
    expect(engine.project).toHaveBeenCalledTimes(2);
  });

  it("should order containers parent-before-child for a depth-2 plan", () => {
    const ice = planIcePortals(exampleSource(), "board-root");
    const plan = planPortalSpawns(ice);
    const spawned = containers(plan);

    expect(spawned.map((step) => step.instanceKey)).toEqual(
      ice.instances.map((instance) => instance.key),
    );
    expect(spawned.map((step) => step.depth)).toEqual([0, 1, 2, 1, 2]);
    expect(spawned.map((step) => step.parentKey)).toEqual([
      null,
      "b:board-root",
      "b:board-root\u001ep:portal-alpha-1\u001eb:board-alpha",
      "b:board-root",
      "b:board-root\u001ep:portal-alpha-2\u001eb:board-alpha",
    ]);

    const engine = recorder();
    const report = spawnIcePortals(plan, engine, KINDS);
    expect(report.failures).toEqual([]);
    expect(engine.calls).toHaveLength(plan.steps.length);

    // Every spawn call lines up with a step, and every child gets its container
    // entity as `parent` — the ordering guarantee in one assertion per step.
    plan.steps.forEach((step, index) => {
      const call = engine.calls[index];
      expect(call?.type).toBe(KINDS[step.kind === "container" ? "board" : step.kind]);
      const owner = step.kind === "container" ? step.parentKey : step.instanceKey;
      expect(call?.opts.parent).toBe(owner === null ? undefined : report.entities.get(owner));
      expect(call?.opts).toMatchObject({
        x: step.box.x,
        y: step.box.y,
        w: step.box.w,
        h: step.box.h,
        undoable: false,
      });
    });

    // Root frame, then one projection per container.
    expect(engine.project).toHaveBeenCalledTimes(1 + spawned.length);
  });

  it("should keep two portals to one board as two instances of one canonical board", () => {
    const plan = planPortalSpawns(planIcePortals(exampleSource(), "board-root"));
    const engine = recorder();
    const report = spawnIcePortals(plan, engine, KINDS);

    const [first, second] = [at(containers(plan), 1), at(containers(plan), 3)];
    expect(first?.key).not.toBe(second?.key);
    expect(first?.boardId).toBe("board-alpha");
    expect(second?.boardId).toBe("board-alpha");
    expect(first?.portalCardId).toBe("portal-alpha-1");
    expect(second?.portalCardId).toBe("portal-alpha-2");

    const alphas = report.boards.get("board-alpha") ?? [];
    expect(alphas).toHaveLength(2);
    expect(alphas[0]).not.toBe(alphas[1]);
    expect(report.boards.get("board-root")).toHaveLength(1);
    expect(report.boards.get("board-beta")).toHaveLength(2);
    expect(report.boards.size).toBe(3);
    expect(report.entities.size).toBe(5);
  });

  it("should spawn a cycle stub after its instance's children with a reason and label", () => {
    const plan = planPortalSpawns(planIcePortals(exampleSource(), "board-root"));
    const alphaKey = at(containers(plan), 1).instanceKey;
    const stub = at(stubSteps(plan, "cycle"), 0);

    expect(stub).toMatchObject({
      kind: "stub",
      key: `${alphaKey}\u001ex:portal-loop`,
      instanceKey: alphaKey,
      boardId: "board-alpha",
      depth: 1,
      portalCardId: "portal-loop",
      reason: "cycle",
      targetBoardId: "board-root",
      targetBoardName: "Root",
      targetDepth: 2,
      label: "Root",
    });
    expect(stub.box).toEqual({
      x: stub.frame.x,
      y: stub.frame.y,
      w: stub.frame.width,
      h: stub.frame.height,
    });

    const childIndexes = plan.steps
      .map((step, index) => ({ step, index }))
      .filter((entry) => entry.step.kind === "container" && entry.step.parentKey === alphaKey)
      .map((entry) => entry.index);
    expect(childIndexes).toHaveLength(1);
    const stubIndex = indexOfStep(plan, stub);
    for (const childIndex of childIndexes) expect(stubIndex).toBeGreaterThan(childIndex);

    const engine = recorder();
    const report = spawnIcePortals(plan, engine, KINDS);
    expect(report.stubs.get(stub.key)?.type).toBe(KINDS.stub);
    // The missing door at the root plus one cycle stub per alpha instance.
    expect(report.stubs.size).toBe(3);
  });

  it("should plan a depth-cap stub and a missing-target stub", () => {
    const plan = planPortalSpawns(planIcePortals(exampleSource(), "board-root", { maxDepth: 1 }));
    const alphaKey = at(containers(plan), 1).instanceKey;

    const depthStub = at(stubSteps(plan, "depth"), 0);
    expect(depthStub).toMatchObject({
      kind: "stub",
      instanceKey: alphaKey,
      boardId: "board-alpha",
      depth: 1,
      portalCardId: "portal-beta",
      targetBoardId: "board-beta",
      targetBoardName: "Beta",
      targetDepth: 2,
      label: "Beta",
    });

    const missingStub = at(stubSteps(plan, "missing"), 0);
    expect(missingStub).toMatchObject({
      kind: "stub",
      instanceKey: "b:board-root",
      boardId: "board-root",
      depth: 0,
      portalCardId: "portal-missing",
      targetBoardId: "board-ghost",
      targetBoardName: null,
      targetDepth: 1,
      label: "Unavailable board",
    });
    // Both stubs of one instance keep the plan's `z` order.
    const alphaStubs = descriptorsOf(plan, alphaKey).filter((step) => step.kind === "stub");
    expect(alphaStubs.map((step) => step.key)).toEqual([
      `${alphaKey}\u001ex:portal-beta`,
      `${alphaKey}\u001ex:portal-loop`,
    ]);
    expect(plan.counts).toEqual({ containers: 3, sections: 3, edges: 3, stubs: 5 });
  });

  it("should put sections, edges and stubs after the instance's cards in paint order", () => {
    const ice = planIcePortals(exampleSource(), "board-root");
    const plan = planPortalSpawns(ice);
    const rootKey = "b:board-root";
    const alphaKey = at(containers(plan), 1).instanceKey;

    expect(descriptorsOf(plan, rootKey).map((step) => step.kind)).toEqual([
      "section",
      "edge",
      "stub",
    ]);
    expect(descriptorsOf(plan, alphaKey).map((step) => step.kind)).toEqual([
      "section",
      "edge",
      "stub",
    ]);

    // "Cards" of an instance are the containers spawned at its portal cards.
    const cardIndexes = (instanceKey: string): number[] =>
      plan.steps
        .map((step, index) => ({ step, index }))
        .filter((entry) => entry.step.kind === "container" && entry.step.parentKey === instanceKey)
        .map((entry) => entry.index);

    const rootFirst = indexOfStep(plan, at(descriptorsOf(plan, rootKey), 0));
    for (const index of cardIndexes(rootKey)) expect(rootFirst).toBeGreaterThan(index);
    const alphaFirst = indexOfStep(plan, at(descriptorsOf(plan, alphaKey), 0));
    for (const index of cardIndexes(alphaKey)) expect(alphaFirst).toBeGreaterThan(index);

    const rootSection = at(descriptorsOf(plan, rootKey), 0);
    expect(rootSection.kind).toBe("section");
    if (rootSection.kind !== "section") throw new Error("expected a section step");
    expect(rootSection.sectionId).toBe("section-root");
    expect(rootSection.rect).toEqual({
      x: 0,
      y: 0,
      width: 700,
      height: 520,
    });
    expect(rootSection.clip).toEqual(at(ice.instances, 0).frame);
    expect(rootSection.box).toEqual({
      x: rootSection.rect.x,
      y: rootSection.rect.y,
      w: rootSection.rect.width,
      h: rootSection.rect.height,
    });

    const rootEdge = at(descriptorsOf(plan, rootKey), 1);
    expect(rootEdge).toMatchObject({ kind: "edge", edgeId: "edge-root", edgeKind: "relates-to" });
  });

  it("should be deterministic and leave the input plan untouched", () => {
    const source = exampleSource();
    const ice = planIcePortals(source, "board-root");
    const before = JSON.stringify(ice);

    const first = planPortalSpawns(ice);
    const second = planPortalSpawns(ice);

    expect(second.steps).toEqual(first.steps);
    expect(second.counts).toEqual(first.counts);
    expect(JSON.stringify(ice)).toBe(before);

    // The same source in a fresh walk yields the same steps too.
    expect(planPortalSpawns(planIcePortals(source, "board-root")).steps).toEqual(first.steps);
  });
});

describe("buildInstanceIdentityMap", () => {
  it("should index instances by key, portal card and canonical board", () => {
    const ice = planIcePortals(exampleSource(), "board-root");
    const map: InstanceIdentityMap = buildInstanceIdentityMap(ice);

    expect(map.rootKey).toBe("b:board-root");
    expect(map.instances.size).toBe(5);
    expect(map.instances.get("b:board-root")).toMatchObject({
      boardId: "board-root",
      boardName: "Root",
      depth: 0,
      portalCardId: null,
      placementId: null,
      parentKey: null,
      path: ["board-root"],
    });

    expect(map.instancesOfBoard("board-alpha")).toHaveLength(2);
    expect(map.instancesOfBoard("board-beta")).toHaveLength(2);
    expect(map.instancesOfBoard("board-ghost")).toEqual([]);

    const opened = map.cardInstances("portal-alpha-1");
    expect(opened).toHaveLength(1);
    expect(at(opened, 0).boardId).toBe("board-alpha");
    expect(at(opened, 0).placementId).toBe("board-root/portal-alpha-1");
    expect(map.cardInstances("portal-beta")).toHaveLength(2);
    expect(map.cardInstances("note-root-1")).toEqual([]);
  });
});

describe("spawnIcePortals", () => {
  it("should report a refused descriptor and keep spawning the rest", () => {
    const plan = planPortalSpawns(planIcePortals(exampleSource(), "board-root"));
    const engine = recorder({ fail: (type) => type === KINDS.section });
    const report = spawnIcePortals(plan, engine, KINDS);

    expect(report.failures).toHaveLength(3);
    expect(report.failures.every((failure) => failure.includes("refused"))).toBe(true);
    expect(report.seeded).toBe(plan.steps.length - 3);
    expect(report.sections.size).toBe(0);
    expect(report.edges.size).toBe(3);
    expect(report.stubs.size).toBe(3);
    expect(report.entities.size).toBe(5);
  });

  it("should report one refused section without losing its siblings", () => {
    const plan = planPortalSpawns(planIcePortals(exampleSource(), "board-root"));
    const engine = recorder({
      fail: (_type, opts) => opts.props?.sectionId === "section-alpha",
    });
    const report = spawnIcePortals(plan, engine, KINDS);

    // One section per alpha instance, so the refused canonical section fails twice.
    expect(report.failures).toHaveLength(2);
    expect(at(report.failures, 0)).toContain("section-alpha");
    expect(report.sections.size).toBe(1);
    expect(report.seeded).toBe(plan.steps.length - 2);
  });

  it("should skip descendants of a refused container and carry on", () => {
    const plan = planPortalSpawns(planIcePortals(exampleSource(), "board-root"));
    let refused = false;
    const engine = recorder({
      fail: (type, opts) => {
        if (type !== KINDS.board || refused) return false;
        if (opts.props?.instanceKey === "b:board-root\u001ep:portal-alpha-1\u001eb:board-alpha") {
          refused = true;
          return true;
        }
        return false;
      },
    });
    const report = spawnIcePortals(plan, engine, KINDS);

    expect(refused).toBe(true);
    expect(at(report.failures, 0)).toContain("refused");
    expect(
      report.failures.some(
        (failure) => failure.includes("its container") && failure.includes("did not spawn"),
      ),
    ).toBe(true);
    // The refused alpha takes its beta child with it; the sibling portal to the
    // same canonical board still opens its own instance.
    expect(report.entities.size).toBe(3);
    expect(report.boards.get("board-alpha")).toHaveLength(1);
    expect(report.boards.get("board-root")).toHaveLength(1);
  });
});

describe("portalFocusTarget", () => {
  it("should describe container entry and the breadcrumb chain", () => {
    const plan = planPortalSpawns(planIcePortals(exampleSource(), "board-root"));
    const report = spawnIcePortals(plan, recorder(), KINDS);

    const root = portalFocusTarget(plan, plan.rootKey, report.entities);
    expect(root).toMatchObject({
      kind: "instance",
      key: "b:board-root",
      depth: 0,
      label: "Root",
      container: report.entities.get("b:board-root"),
      parentKey: null,
      stub: null,
      reason: null,
    });
    expect(root?.breadcrumbs.map((crumb) => crumb.label)).toEqual(["Root"]);

    const betaKey = at(containers(plan), 2).instanceKey;
    const beta = portalFocusTarget(plan, betaKey, report.entities);
    expect(beta?.breadcrumbs.map((crumb) => crumb.label)).toEqual(["Root", "Alpha", "Beta"]);
    expect(beta?.container).toBe(report.entities.get(betaKey));

    expect(portalFocusTarget(plan, "b:nowhere")).toBeNull();
  });

  it("should frame a stub instead of entering a container", () => {
    const ice = planIcePortals(exampleSource(), "board-root", { maxDepth: 1 });
    const plan = planPortalSpawns(ice);
    const report = spawnIcePortals(plan, recorder(), KINDS);
    const stub = at(stubSteps(plan, "depth"), 0);

    const target = portalFocusTarget(plan, stub.key, spawnReportEntities(report));
    expect(target).toMatchObject({
      kind: "stub",
      key: stub.key,
      instanceKey: stub.instanceKey,
      boardId: "board-alpha",
      boardName: "Alpha",
      label: "Beta",
      container: null,
      parentKey: stub.instanceKey,
      stub: report.stubs.get(stub.key),
      reason: "depth",
      targetBoardId: "board-beta",
      targetBoardName: "Beta",
    });
    expect(target?.breadcrumbs.map((crumb) => crumb.label)).toEqual(["Root", "Alpha", "Beta"]);
    expect(target?.box).toEqual({
      x: stub.frame.x,
      y: stub.frame.y,
      w: stub.frame.width,
      h: stub.frame.height,
    });
  });
});
