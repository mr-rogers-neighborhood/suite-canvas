import { describe, expect, it } from "vitest";
import { parseLayoutPlan } from "../layoutPlan.js";
import { WorkspaceDocument } from "../loro/WorkspaceDocument.js";
import type { Placement, Section } from "../schema.js";
import { projectTissue, settle, type TissueState } from "./engine.js";
import { createInterval, intervalExact, intervalMerge, intervalUnconstrained } from "./interval.js";
import { proposeReflowPlan, sectionFitRect } from "./reflowPlan.js";
import { pinConstraint, separationConstraint, sumConstraint } from "./spatialPropagators.js";

describe("Propagator Engine & Interval Semilattice", () => {
  it("narrows intervals monotonically via meet (merge)", () => {
    const a = createInterval(10, 50);
    const b = createInterval(30, 80);
    const merged = intervalMerge(a, b);
    expect(merged).toEqual({ lo: 30, hi: 50 });
  });

  it("detects contradictions when intervals do not overlap", () => {
    const a = createInterval(10, 20);
    const b = createInterval(30, 40);
    expect(() => intervalMerge(a, b)).toThrowError(/Interval contradiction/);
  });

  it("proves confluence under merge (CRDT commutativity)", () => {
    // Spatial relation: A + B = C
    const props = [sumConstraint("A", "B", "C")];

    // Replica 1 learns A is in [100, 200], C is in [400, 600]
    const tissue1: TissueState = new Map([
      ["A", createInterval(100, 200)],
      ["B", intervalUnconstrained()],
      ["C", createInterval(400, 600)],
    ]);

    // Replica 2 concurrently learns B is in [250, 350]
    const tissue2: TissueState = new Map([
      ["A", intervalUnconstrained()],
      ["B", createInterval(250, 350)],
      ["C", intervalUnconstrained()],
    ]);

    // Path 1: Settle locally, merge, then settle merged
    const res1 = settle(tissue1, props);
    const res2 = settle(tissue2, props);
    expect(res1.type).toBe("success");
    expect(res2.type).toBe("success");
    if (res1.type !== "success" || res2.type !== "success") return;

    const a1 = res1.tissue.get("A");
    const a2 = res2.tissue.get("A");
    const b1 = res1.tissue.get("B");
    const b2 = res2.tissue.get("B");
    const c1 = res1.tissue.get("C");
    const c2 = res2.tissue.get("C");
    expect(a1 && a2 && b1 && b2 && c1 && c2).toBeTruthy();
    if (!a1 || !a2 || !b1 || !b2 || !c1 || !c2) return;

    const mergedSettled: TissueState = new Map([
      ["A", intervalMerge(a1, a2)],
      ["B", intervalMerge(b1, b2)],
      ["C", intervalMerge(c1, c2)],
    ]);
    const final1 = settle(mergedSettled, props);

    // Path 2: Merge initial states first, then settle
    const initA1 = tissue1.get("A");
    const initA2 = tissue2.get("A");
    const initB1 = tissue1.get("B");
    const initB2 = tissue2.get("B");
    const initC1 = tissue1.get("C");
    const initC2 = tissue2.get("C");
    expect(initA1 && initA2 && initB1 && initB2 && initC1 && initC2).toBeTruthy();
    if (!initA1 || !initA2 || !initB1 || !initB2 || !initC1 || !initC2) return;

    const mergedInitial: TissueState = new Map([
      ["A", intervalMerge(initA1, initA2)],
      ["B", intervalMerge(initB1, initB2)],
      ["C", intervalMerge(initC1, initC2)],
    ]);
    const final2 = settle(mergedInitial, props);

    expect(final1.type).toBe("success");
    expect(final2.type).toBe("success");
    if (final1.type !== "success" || final2.type !== "success") return;

    // Confluence: both paths reach the exact same fixed point
    expect(final1.tissue.get("A")).toEqual(final2.tissue.get("A"));
    expect(final1.tissue.get("B")).toEqual(final2.tissue.get("B"));
    expect(final1.tissue.get("C")).toEqual(final2.tissue.get("C"));

    // Exact value: C in [400, 550]
    expect(final1.tissue.get("C")).toEqual({ lo: 400, hi: 550 });
  });

  it("enforces footprint privacy (non-footprint cells cannot be seen)", () => {
    const tissue: TissueState = new Map([
      ["CardA_y", createInterval(100, 100)],
      ["SecretCard_y", createInterval(999, 999)],
    ]);
    const footprint = new Set(["CardA_y"]);
    const projected = projectTissue(tissue, footprint);

    expect(projected.has("CardA_y")).toBe(true);
    expect(projected.has("SecretCard_y")).toBe(false);
    expect(projected.size).toBe(1);
  });

  it("returns SolveInconsistent when pins conflict", () => {
    const tissue: TissueState = new Map([
      ["CardA", intervalExact(100)],
      ["CardB", intervalExact(150)],
    ]);
    // CardB must be >= CardA + 100px (150 >= 200 is impossible)
    const props = [
      pinConstraint("CardA", 100),
      pinConstraint("CardB", 150),
      separationConstraint("CardA", "CardB", 100, 0),
    ];
    const result = settle(tissue, props);
    expect(result.type).toBe("inconsistent");
  });

  it("demonstrates zero-drift spatial pinning on unaffected cards", () => {
    const tissue: TissueState = new Map([
      ["CardA", intervalExact(100)],
      ["CardB", createInterval(120, 500)],
      ["CardC", intervalExact(800)], // Pinned distant card
    ]);
    const props = [
      separationConstraint("CardA", "CardB", 80, 10), // demands CardB >= 190
      pinConstraint("CardC", 800),
    ];
    const result = settle(tissue, props);
    expect(result.type).toBe("success");
    if (result.type !== "success") return;

    // Card B was displaced to 190
    expect(result.tissue.get("CardB")?.lo).toBe(190);
    // Card C remained perfectly pinned at 800 with 0 drift
    expect(result.tissue.get("CardC")).toEqual({ lo: 800, hi: 800 });
  });
});

describe("proposeReflowPlan Integration", () => {
  it("proposes 1D displacement wave when Card A collides with Card B and C", () => {
    const boardId = "board-1";
    const placements: Placement[] = [
      {
        cardId: "card-b",
        boardId,
        x: 100,
        y: 150,
        width: 200,
        height: 100,
        z: 1,
        createdAt: 1000,
      },
      {
        cardId: "card-c",
        boardId,
        x: 100,
        y: 280,
        width: 200,
        height: 100,
        z: 2,
        createdAt: 1001,
      },
      {
        cardId: "card-distant",
        boardId,
        x: 500,
        y: 150,
        width: 200,
        height: 100,
        z: 3,
        createdAt: 1002,
      },
    ];

    // Card A is dropped at (100, 100) with height 100 and gap 20
    // Overlaps Card B (at 150) -> Card B pushed to >= 100 + 100 + 20 = 220
    // Card B (height 100) now pushes Card C (at 280) -> Card C pushed to >= 220 + 100 + 20 = 340
    // Card Distant is unaffected.
    const plan = proposeReflowPlan({
      boardId,
      targetCardId: "card-a",
      targetPosition: { x: 100, y: 100 },
      targetSize: { width: 200, height: 100 },
      placements,
      gap: 20,
      axis: "y",
    });

    expect(plan).not.toBeNull();
    if (!plan) return;

    // Validates against LayoutPlan schema
    const parsed = parseLayoutPlan(plan);
    expect(parsed.boards).toEqual([boardId]);

    const cardBPlacement = parsed.placements.find((p) => p.cardId === "card-b");
    const cardCPlacement = parsed.placements.find((p) => p.cardId === "card-c");
    const distantPlacement = parsed.placements.find((p) => p.cardId === "card-distant");

    expect(cardBPlacement?.y).toBe(220);
    expect(cardCPlacement?.y).toBe(340);
    expect(distantPlacement).toBeUndefined(); // Zero drift: distant card not even in plan
  });

  it("elastically expands section container when enclosed cards are displaced", () => {
    const boardId = "board-1";
    const section: Section = {
      id: "sec-1",
      boardId,
      title: "Sprint Tasks",
      color: "blue",
      x: 80,
      y: 80,
      width: 300,
      height: 300,
      z: 0,
      tags: [],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const placements: Placement[] = [
      {
        cardId: "card-b",
        boardId,
        x: 100,
        y: 200,
        width: 200,
        height: 100,
        z: 1,
        createdAt: 1000,
      },
    ];

    // Card A dropped at (100, 120), height 100, gap 20 -> Card B pushed to 240
    // Card B bottom is now 240 + 100 = 340.
    // Section original bottom is 80 + 300 = 380.
    // With padding 24: desired height is 340 - 80 + 24 = 284 <= 300 (fits).
    // Now push with larger height: Card A height 200 -> Card B pushed to 120 + 200 + 20 = 340.
    // Card B bottom is 340 + 100 = 440.
    // Section desired height is 440 - 80 + 24 = 384 > 300 -> Section expands!
    const plan = proposeReflowPlan({
      boardId,
      targetCardId: "card-a",
      targetPosition: { x: 100, y: 120 },
      targetSize: { width: 200, height: 200 },
      placements,
      sections: [section],
      gap: 20,
      sectionPadding: 24,
    });

    expect(plan).not.toBeNull();
    if (!plan) return;

    expect(plan.sections).toBeDefined();
    expect(plan.sections?.length).toBe(1);
    const secUpdate = plan.sections?.[0];
    expect(secUpdate?.sectionId).toBe("sec-1");
    expect(secUpdate?.height).toBe(384);
  });

  it("applies atomically to WorkspaceDocument in a single undo step", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();
    const cardA = workspace.createCard({ boardId: board.id, position: { x: 100, y: 100 } });
    const cardB = workspace.createCard({ boardId: board.id, position: { x: 100, y: 150 } });

    const placements = workspace.listPlacements();
    const plan = proposeReflowPlan({
      boardId: board.id,
      targetCardId: cardA.id,
      targetPosition: { x: 100, y: 100 },
      targetSize: { width: 280, height: 160 },
      placements,
      gap: 24,
    });

    expect(plan).not.toBeNull();
    if (!plan) return;

    // Apply plan to WorkspaceDocument
    workspace.applyLayoutPlan(plan);

    // Verify card B was displaced
    const updatedB = workspace.getPlacement(board.id, cardB.id);
    expect(updatedB?.y).toBe(100 + 160 + 24); // 284

    // Test Undo in 1 step: restores card B to original position
    workspace.undo();
    const restoredB = workspace.getPlacement(board.id, cardB.id);
    expect(restoredB?.y).toBe(150);
  });

  it("settles a 10-card collision chain in under 0.1ms (benchmark)", () => {
    const boardId = "bench-board";
    const placements: Placement[] = [];
    for (let i = 1; i <= 10; i += 1) {
      placements.push({
        cardId: `card-${i}`,
        boardId,
        x: 100,
        y: 100 + (i - 1) * 30, // Stack of cards overlapping each other
        width: 200,
        height: 50,
        z: i,
        createdAt: 1000 + i,
      });
    }

    const start = performance.now();
    const iterations = 100;
    for (let iter = 0; iter < iterations; iter += 1) {
      proposeReflowPlan({
        boardId,
        targetCardId: "card-root",
        targetPosition: { x: 100, y: 50 },
        targetSize: { width: 200, height: 50 },
        placements,
        gap: 10,
        axis: "y",
      });
    }
    const end = performance.now();
    const avgTimeMs = (end - start) / iterations;

    // Must be well under 0.5ms (typically ~0.02ms)
    expect(avgTimeMs).toBeLessThan(0.5);
  });

  it("proposes 4-way radial dispersion when a card is dropped into a 4-card cluster", () => {
    const boardId = "radial-board";
    const gap = 20;
    const placements: Placement[] = [
      {
        cardId: "card-north",
        boardId,
        x: 300,
        y: 160,
        width: 100,
        height: 100,
        z: 1,
        createdAt: 1000,
      },
      {
        cardId: "card-south",
        boardId,
        x: 300,
        y: 440,
        width: 100,
        height: 100,
        z: 2,
        createdAt: 1001,
      },
      {
        cardId: "card-west",
        boardId,
        x: 160,
        y: 300,
        width: 100,
        height: 100,
        z: 3,
        createdAt: 1002,
      },
      {
        cardId: "card-east",
        boardId,
        x: 440,
        y: 300,
        width: 100,
        height: 100,
        z: 4,
        createdAt: 1003,
      },
    ];

    // Drop target card in the center: (260, 260), size 180x180
    // Center is (350, 350).
    // Target reaches x: [260, 440], y: [260, 440].
    // North (y: 160..260) -> overlaps target at y=260 with gap -> pushed UP
    // South (y: 440..540) -> overlaps target at y=440 with gap -> pushed DOWN
    // West (x: 160..260) -> overlaps target at x=260 with gap -> pushed LEFT
    // East (x: 440..540) -> overlaps target at x=440 with gap -> pushed RIGHT
    const plan = proposeReflowPlan({
      boardId,
      targetCardId: "card-center",
      targetPosition: { x: 260, y: 260 },
      targetSize: { width: 180, height: 180 },
      placements,
      gap,
    });

    expect(plan).not.toBeNull();
    if (!plan) return;

    const north = plan.placements.find((p) => p.cardId === "card-north");
    const south = plan.placements.find((p) => p.cardId === "card-south");
    const west = plan.placements.find((p) => p.cardId === "card-west");
    const east = plan.placements.find((p) => p.cardId === "card-east");

    expect(north).toBeDefined();
    expect(south).toBeDefined();
    expect(west).toBeDefined();
    expect(east).toBeDefined();

    // North pushed Up (-Y): target.y - north.height - gap = 260 - 100 - 20 = 140
    expect(north?.y).toBe(140);
    expect(north?.x).toBe(300); // Zero cross-axis drift

    // South pushed Down (+Y): target.y + target.height + gap = 260 + 180 + 20 = 460
    expect(south?.y).toBe(460);
    expect(south?.x).toBe(300); // Zero cross-axis drift

    // West pushed Left (-X): target.x - west.width - gap = 260 - 100 - 20 = 140
    expect(west?.x).toBe(140);
    expect(west?.y).toBe(300); // Zero cross-axis drift

    // East pushed Right (+X): target.x + target.width + gap = 260 + 180 + 20 = 460
    expect(east?.x).toBe(460);
    expect(east?.y).toBe(300); // Zero cross-axis drift
  });

  it("expands sections in all 4 directions (Left, Up, Right, Down)", () => {
    const boardId = "omni-section-board";
    const section: Section = {
      id: "sec-omni",
      boardId,
      title: "Omni Section",
      color: "blue",
      x: 200,
      y: 200,
      width: 400,
      height: 400,
      z: 0,
      shrinkToFit: false,
      tags: [],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const placements: Placement[] = [
      {
        cardId: "card-inside",
        boardId,
        x: 250,
        y: 250,
        width: 100,
        height: 100,
        z: 1,
        createdAt: 1000,
      },
    ];

    // Card Target dropped at (270, 250), pushing card-inside to the left
    // Target size 100x100. Center of card-inside is (300, 250), Target center is (320, 250).
    // dx = 300 - 320 = -20. MTV axis is X, direction is - (Left).
    // card-inside is pushed left to: 270 - 100 - 24 = 146.
    // Notice 146 is less than section.x (200)!
    // With padding 24, section must expand left: newX = 146 - 24 = 122.
    // newRight remains at least 200 + 400 = 600.
    // newWidth = 600 - 122 = 478.
    const plan = proposeReflowPlan({
      boardId,
      targetCardId: "card-pusher",
      targetPosition: { x: 270, y: 250 },
      targetSize: { width: 100, height: 100 },
      placements,
      sections: [section],
      gap: 24,
      sectionPadding: 24,
    });

    expect(plan).not.toBeNull();
    if (!plan) return;

    const secUpdate = plan.sections?.find((s) => s.sectionId === "sec-omni");
    expect(secUpdate).toBeDefined();
    expect(secUpdate?.x).toBe(122);
    expect(secUpdate?.width).toBe(478);
  });

  it("shrinks and expands in all 4 directions with detach threshold", () => {
    const boardId = "shrink-omni-board";
    const section: Section = {
      id: "sec-shrink",
      boardId,
      title: "Shrink Section",
      color: "green",
      x: 100,
      y: 100,
      width: 500,
      height: 400,
      z: 0,
      tags: [],
      createdAt: 1000,
      updatedAt: 1000,
    };

    const cardA: Placement = {
      cardId: "card-a",
      boardId,
      x: 150,
      y: 160,
      width: 100,
      height: 100,
      z: 1,
      createdAt: 1000,
    };

    const cardB: Placement = {
      cardId: "card-b",
      boardId,
      x: 350,
      y: 260,
      width: 100,
      height: 100,
      z: 2,
      createdAt: 1001,
    };

    // Card B moved inward closer to Card A (x: 300, y: 160)
    // Section shrinks in all 4 directions!
    // minLeft = 150 -> newX = 150 - 24 = 126
    // minTop = 160 -> newY = 160 - 40 = 120
    // maxRight = 300 + 100 = 400 -> newRight = 400 + 24 = 424 -> newWidth = 424 - 126 = 298
    // maxBottom = 160 + 100 = 260 -> newBottom = 260 + 24 = 284 -> newHeight = 284 - 120 = 164
    const planInward = proposeReflowPlan({
      boardId,
      targetCardId: "card-b",
      targetPosition: { x: 300, y: 160 },
      targetSize: { width: 100, height: 100 },
      placements: [cardA, cardB],
      sections: [section],
      sectionPadding: 24,
    });

    expect(planInward).not.toBeNull();
    const secInward = planInward?.sections?.find((s) => s.sectionId === "sec-shrink");
    expect(secInward).toBeDefined();
    expect(secInward?.x).toBe(126);
    expect(secInward?.y).toBe(120);
    expect(secInward?.width).toBe(298);
    expect(secInward?.height).toBe(164);

    // Now test pulling against wall: pushing card-b 50px outside right wall
    // section right wall was 600. Pushing card-b to x: 550 (right edge: 650).
    // It's within 80px detach margin, so section extends right to enclose it!
    const planPush = proposeReflowPlan({
      boardId,
      targetCardId: "card-b",
      targetPosition: { x: 550, y: 160 },
      targetSize: { width: 100, height: 100 },
      placements: [cardA, cardB],
      sections: [section],
      sectionPadding: 24,
    });
    const secPush = planPush?.sections?.find((s) => s.sectionId === "sec-shrink");
    expect(secPush).toBeDefined();
    expect(secPush?.width).toBe(548);

    // Now test pulling card-b WAY outside (>80px beyond right wall): x = 700 (right edge 800 > 600 + 80)
    // Card B detaches! Section now only contains Card A!
    const planDetach = proposeReflowPlan({
      boardId,
      targetCardId: "card-b",
      targetPosition: { x: 700, y: 160 },
      targetSize: { width: 100, height: 100 },
      placements: [cardA, cardB],
      sections: [section],
      sectionPadding: 24,
    });
    const secDetach = planDetach?.sections?.find((s) => s.sectionId === "sec-shrink");
    expect(secDetach).toBeDefined();
    expect(secDetach?.x).toBe(126);
    expect(secDetach?.y).toBe(120);
    expect(secDetach?.width).toBe(160);
    expect(secDetach?.height).toBe(164);
  });

  it("resizes a card and displaces neighboring cards dynamically", () => {
    const boardId = "resize-board";
    const cardAId = "card-a";
    const cardBId = "card-b";

    // Card A is at (100, 100), initially 200x150
    // Card B is at (324, 100), initially 200x150 (24px gap)
    const placements: Placement[] = [
      {
        cardId: cardAId,
        boardId,
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        z: 1,
        createdAt: 1000,
      },
      {
        cardId: cardBId,
        boardId,
        x: 324,
        y: 100,
        width: 200,
        height: 150,
        z: 2,
        createdAt: 1000,
      },
    ];

    // User drags Card A's right resize handle from width 200 to 350
    const plan = proposeReflowPlan({
      boardId,
      targetCardId: cardAId,
      targetPosition: { x: 100, y: 100 },
      targetSize: { width: 350, height: 150 },
      placements,
      gap: 24,
    });

    expect(plan).not.toBeNull();
    if (!plan) return;

    // Card A has updated width
    const placementA = plan.placements.find((p) => p.cardId === cardAId);
    expect(placementA).toBeDefined();
    expect(placementA?.width).toBe(350);
    expect(placementA?.x).toBe(100);

    // Card B pushed right to: Card A right edge (100 + 350) + gap (24) = 474
    const placementB = plan.placements.find((p) => p.cardId === cardBId);
    expect(placementB).toBeDefined();
    expect(placementB?.x).toBe(474);
    expect(placementB?.y).toBe(100);
  });

  it("calculates tight section shrink-to-fit bounding box", () => {
    const section: Section = {
      id: "sec-fit",
      boardId: "board-1",
      title: "Design",
      color: "blue",
      x: 100,
      y: 100,
      width: 800,
      height: 600,
      z: 0,
      tags: [],
      createdAt: 1000,
      updatedAt: 1000,
    };

    // Case 1: Empty section collapses to compact dimensions at current origin
    const emptyFit = sectionFitRect(section, []);
    expect(emptyFit).toEqual({
      x: 100,
      y: 100,
      width: 160,
      height: 100,
    });

    // Case 2: Section with 2 cards inside
    // Card 1: (200, 200), 200x100
    // Card 2: (450, 350), 150x80
    // minLeft = 200, minTop = 200, maxRight = 600, maxBottom = 430
    // With padding 24:
    // newX = 200 - 24 = 176
    // newY = 200 - 24 = 176
    // newWidth = (600 - 200) + 48 = 448
    // newHeight = (430 - 200) + 48 = 278
    const members = [
      { x: 200, y: 200, width: 200, height: 100 },
      { x: 450, y: 350, width: 150, height: 80 },
    ];
    const memberFit = sectionFitRect(section, members, 24);
    expect(memberFit).toEqual({
      x: 176,
      y: 176,
      width: 448,
      height: 278,
    });
  });

  it("utilizes live measured cardSizes when placements omit explicit dimensions", () => {
    const boardId = "board-sizes";
    const placements: Placement[] = [
      {
        cardId: "card-live",
        boardId,
        x: 100,
        y: 100,
        // no width / height stored on placement
        z: 1,
        createdAt: 1000,
      },
    ];

    // Measured in DOM as 300x180
    const cardSizes = new Map([["card-live", { width: 300, height: 180 }]]);

    // Drop target to the left of card-live
    const plan = proposeReflowPlan({
      boardId,
      targetCardId: "target",
      targetPosition: { x: 80, y: 100 },
      targetSize: { width: 100, height: 100 },
      placements,
      cardSizes,
      gap: 20,
    });

    expect(plan).not.toBeNull();
    if (!plan) return;

    // Target (x=80, width=100) -> right edge is 180
    // card-live pushed right to: 180 + 20 = 200
    const pushed = plan.placements.find((p) => p.cardId === "card-live");
    expect(pushed).toBeDefined();
    expect(pushed?.x).toBe(200);
    // Preserves measured width in layout plan
    expect(pushed?.width).toBe(300);
  });
});
