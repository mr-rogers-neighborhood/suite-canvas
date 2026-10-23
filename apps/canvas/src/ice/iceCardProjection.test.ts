import { describe, expect, it, vi } from "vitest";
import { type CanonicalPlacement, CardProjection, placementBox } from "./iceCardProjection";

const NATURAL = { width: 288, height: 240 };

interface FakeEntity {
  readonly id: number;
  box: { x: number; y: number; width: number; height: number };
}

function harness() {
  let next = 0;
  const alive = new Set<FakeEntity>();
  const spawn = vi.fn((placement: CanonicalPlacement): FakeEntity => {
    next += 1;
    const entity: FakeEntity = {
      id: next,
      box: placementBox(placement, NATURAL),
    };
    alive.add(entity);
    return entity;
  });
  const remove = vi.fn((entity: FakeEntity) => {
    alive.delete(entity);
  });
  const boxOf = vi.fn((entity: FakeEntity) => entity.box);
  const projection = new CardProjection<FakeEntity>({ spawn, remove, boxOf });
  return { projection, spawn, remove, boxOf, alive };
}

function placement(patch: Partial<CanonicalPlacement> = {}): CanonicalPlacement {
  return { boardId: "board-1", cardId: "card-1", x: 10, y: 20, ...patch };
}

describe("placementBox", () => {
  it("should use the stored size when a placement has one", () => {
    expect(placementBox(placement({ width: 100, height: 50 }), NATURAL)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it("should fall back to the natural size when a placement stores none", () => {
    expect(placementBox(placement(), NATURAL)).toEqual({
      x: 10,
      y: 20,
      width: 288,
      height: 240,
    });
  });
});

describe("CardProjection", () => {
  it("should spawn every canonical placement once", () => {
    const { projection, spawn } = harness();
    const report = projection.reconcile([placement(), placement({ cardId: "card-2" })], NATURAL);

    expect(report.spawned).toHaveLength(2);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(projection.entityOf("card-1")).toBeDefined();
    expect(projection.infoOf(projection.entityOf("card-2") as FakeEntity)).toEqual({
      cardId: "card-2",
      boardId: "board-1",
    });
  });

  it("should leave an entity alone when its geometry already agrees", () => {
    const { projection, spawn, remove } = harness();
    projection.reconcile([placement()], NATURAL);
    spawn.mockClear();

    const report = projection.reconcile([placement()], NATURAL);

    expect(report.spawned).toHaveLength(0);
    expect(report.moved).toHaveLength(0);
    expect(spawn).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("should tolerate sub-pixel drift instead of re-spawning", () => {
    const { projection, spawn } = harness();
    const entity = projection.spawn(placement());
    entity.box = { x: 10.4, y: 19.6, width: 288, height: 240 };
    spawn.mockClear();

    projection.reconcile([placement()], NATURAL);

    expect(spawn).not.toHaveBeenCalled();
  });

  it("should re-spawn a card whose canonical position moved", () => {
    const { projection, spawn, remove } = harness();
    const before = projection.spawn(placement());
    spawn.mockClear();

    const report = projection.reconcile([placement({ x: 400 })], NATURAL);

    expect(remove).toHaveBeenCalledWith(before);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(report.moved).toHaveLength(1);
    expect(projection.entityOf("card-1")?.box.x).toBe(400);
  });

  it("should re-spawn a card whose canonical size changed", () => {
    const { projection, spawn } = harness();
    projection.spawn(placement());
    spawn.mockClear();

    const report = projection.reconcile([placement({ width: 500, height: 400 })], NATURAL);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(report.moved).toHaveLength(1);
    expect(projection.entityOf("card-1")?.box.width).toBe(500);
  });

  it("should remove an entity whose placement disappeared", () => {
    const { projection, remove } = harness();
    const entity = projection.spawn(placement());
    projection.spawn(placement({ cardId: "card-2" }));

    const report = projection.reconcile([placement({ cardId: "card-2" })], NATURAL);

    expect(remove).toHaveBeenCalledWith(entity);
    expect(report.removed).toHaveLength(1);
    expect(projection.entityOf("card-1")).toBeUndefined();
    expect(projection.entityOf("card-2")).toBeDefined();
  });

  it("should re-spawn everything when forced", () => {
    const { projection, spawn } = harness();
    projection.spawn(placement());
    spawn.mockClear();

    const report = projection.reconcile([placement()], NATURAL, { force: true });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(report.moved).toHaveLength(1);
  });

  it("should re-spawn when the entity has no readable geometry", () => {
    const { projection, spawn, boxOf } = harness();
    projection.spawn(placement());
    spawn.mockClear();
    boxOf.mockReturnValue(
      null as unknown as { x: number; y: number; width: number; height: number },
    );

    const report = projection.reconcile([placement()], NATURAL);

    expect(report.moved).toHaveLength(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("should keep going when one spawn is refused", () => {
    const { projection, spawn } = harness();
    spawn.mockImplementationOnce(() => {
      throw new Error("refused");
    });

    const report = projection.reconcile([placement(), placement({ cardId: "card-2" })], NATURAL);

    expect(report.failures[0]).toContain("spawn card-1");
    expect(report.spawned).toHaveLength(1);
    expect(projection.entityOf("card-2")).toBeDefined();
  });

  it("should keep the first placement when a card is placed twice", () => {
    const { projection, spawn } = harness();

    projection.reconcile([placement(), placement({ x: 999 })], NATURAL);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(projection.entityOf("card-1")?.box.x).toBe(10);
  });

  it("should remove every entity on dispose and stay idempotent", () => {
    const { projection, remove, alive } = harness();
    projection.spawn(placement());
    projection.spawn(placement({ cardId: "card-2" }));

    projection.dispose();
    projection.dispose();

    expect(remove).toHaveBeenCalledTimes(2);
    expect(alive.size).toBe(0);
    expect(projection.entities()).toHaveLength(0);
  });

  it("should report a refused removal without losing the other entities", () => {
    const { projection, remove } = harness();
    const first = projection.spawn(placement());
    projection.spawn(placement({ cardId: "card-2" }));
    remove.mockImplementationOnce(() => {
      throw new Error("stuck");
    });

    const report = projection.reconcile([placement({ cardId: "card-2" })], NATURAL);

    expect(report.failures[0]).toContain("remove card-1");
    // The registration is gone even when the engine refused, so a later sweep retries cleanly.
    expect(projection.entityOf("card-1")).toBeUndefined();
    expect(projection.entities()).not.toContain(first);
  });
});
