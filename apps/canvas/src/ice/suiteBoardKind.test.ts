import { boardColors } from "@suite/graph";
import { Position, PrefabId, Size, type World } from "@vibecook/ice";
import {
  CONTAINABLE,
  DESK_OBJECT,
  driversOf,
  hostOf,
  type ObjectDomHost,
  objectKindOf,
} from "@vibecook/ice/desk";
import { describe, expect, it } from "vitest";
import {
  boardVinyl,
  SUITE_BOARD_DEFAULTS,
  SUITE_BOARD_FACE,
  SUITE_BOARD_INTERACTION,
  SUITE_BOARD_KIND,
  SUITE_BOARD_LAYER_Z,
  SUITE_BOARD_SIZE,
  SUITE_BOARD_TYPE,
  SUITE_BOARD_VINYL_BY_COLOR,
  SuiteBoard,
  type SuiteBoardFace,
  suiteBoardSpawn,
} from "./suiteBoardKind";

/**
 * The Board's declared surface, without a desk: the props the projection
 * writes, the flags it declares, and the reused mat program under our name.
 */
describe("suite.board kind", () => {
  it("should expose the same type and kind name", () => {
    expect(SuiteBoard.type).toBe(SUITE_BOARD_TYPE);
    // The ground registers the reused mat program under this name, so they agree.
    expect(SUITE_BOARD_KIND).toBe(SUITE_BOARD_TYPE);
    expect(objectKindOf(SuiteBoard)?.name).toBe(SUITE_BOARD_KIND);
  });

  it("should carry a Board's whole face on the board group", () => {
    expect(SuiteBoard.propToGroup).toMatchObject({
      boardId: "board",
      name: "board",
      depth: "board",
      color: "board",
      cardCount: "board",
      childCount: "board",
      collapsed: "board",
    });
    expect(SuiteBoard.groups.find((group) => group.name === "board")).toBeDefined();
    expect(SUITE_BOARD_FACE).toBeDefined();
  });

  it("should spawn at the footprint the mini mat it replaces used", () => {
    expect(SuiteBoard.defaultSize).toEqual(SUITE_BOARD_SIZE);
    expect(SUITE_BOARD_SIZE).toEqual({ w: 640, h: 480 });
  });

  it("should be selectable and movable, never resized, snapped both ways", () => {
    expect(SUITE_BOARD_INTERACTION).toEqual({
      selectable: true,
      movable: true,
      resizable: false,
      snap: "both",
      drop: "into",
    });
    // "into" is ICE's name for "may be dropped inside a container".
    expect(SuiteBoard.drop).toBe("into");
  });

  it("should be a desk object that is also a container, so Boards nest", () => {
    expect(SuiteBoard.provides).toContain(DESK_OBJECT);
    expect(SuiteBoard.container?.accepts).toContain(CONTAINABLE);
    // A Board provides itself as containable, so a Board can hold a Board.
    expect(SuiteBoard.provides).toContain(SUITE_BOARD_TYPE);
    expect(SuiteBoard.provides).toContain(CONTAINABLE);
    expect(SuiteBoard.container?.portal.top).toBeGreaterThan(0);
    expect(typeof driversOf(SuiteBoard)).toBe("function");
    expect(typeof hostOf(SuiteBoard)?.mount).toBe("function");
  });

  it("should draw above the cards it holds", () => {
    // The card overlay sits at z-index 2; a Board's identity must read over its
    // own contents at distance.
    expect(SUITE_BOARD_LAYER_Z).toBeGreaterThan(2);
  });

  it("should mount its face layer for the Boards on the desk", () => {
    const container = document.createElement("div");
    const face: SuiteBoardFace = {
      boardId: "board-1",
      name: "",
      depth: 0,
      color: "violet",
      cardCount: 5,
      childCount: 0,
      collapsed: false,
    };
    const components = new Map<unknown, unknown>([
      [PrefabId, { id: SUITE_BOARD_TYPE }],
      [Position, { x: 10, y: 20 }],
      [Size, { w: 640, h: 480 }],
      [SUITE_BOARD_FACE, face],
    ]);
    const world = {
      entities: () => [7],
      isAlive: () => true,
      has: (_entity: unknown, component: unknown) => components.has(component),
      read: (_entity: unknown, component: unknown) => components.get(component),
      getResource: () => ({ x: 0, y: 0, zoom: 1 }),
    } as unknown as World;
    const mount = hostOf(SuiteBoard)?.mount;
    expect(mount).toBeDefined();
    mount?.({ container, world } as unknown as ObjectDomHost);

    const painted = container.querySelector<HTMLElement>('[data-testid="suite-board-face"]');
    expect(painted?.style.left).toBe("10px");
    expect(painted?.style.width).toBe("640px");
    expect(painted?.style.getPropertyValue("--suite-board-accent")).toContain("--section-violet");
    // An unnamed Board still says what it is.
    expect(container.textContent).toContain("Board");
    expect(container.textContent).toContain("5");
  });

  it("should spawn a Board with its rect in the parent's frame untouched", () => {
    const spawn = suiteBoardSpawn({
      boardId: "board-2",
      name: "  Reading room ",
      depth: 1,
      color: "rose",
      cardCount: 12,
      childCount: 3,
      x: 40,
      y: 30,
      width: 520,
      height: 360,
    });
    expect(spawn).toEqual({
      type: "suite.board",
      x: 40,
      y: 30,
      w: 520,
      h: 360,
      props: {
        boardId: "board-2",
        name: "Reading room",
        depth: 1,
        color: "rose",
        cardCount: 12,
        childCount: 3,
        collapsed: false,
        vinyl: "charcoal",
      },
    });
  });

  it("should name an unnamed Board rather than spawn an empty title", () => {
    const spawn = suiteBoardSpawn({
      boardId: "board-3",
      name: "",
      depth: 0,
      color: "slate",
      cardCount: 0,
      childCount: 0,
      x: 0,
      y: 0,
      width: 640,
      height: 480,
    });
    expect(spawn.props.name).toBe(SUITE_BOARD_DEFAULTS.name);
  });

  it("should lie on the nearest vinyl for every board colour", () => {
    const vinyls = new Set<string>();
    for (const color of boardColors) {
      const vinyl = boardVinyl(color);
      expect(vinyl).toBe(SUITE_BOARD_VINYL_BY_COLOR[color]);
      vinyls.add(vinyl);
    }
    // The six colours resolve to the three materials the mat program knows.
    expect(vinyls.size).toBe(3);
    expect(boardVinyl("not-a-colour")).toBe("sage");
    expect(boardVinyl(undefined)).toBe("sage");
  });
});
