import { boardColors } from "@suite/graph";
import { Position, PrefabId, Size, type World } from "@vibecook/ice";
import {
  CONTAINABLE,
  DESK_OBJECT,
  driversOf,
  hostOf,
  kindPalette,
  type ObjectDomHost,
  objectKindOf,
} from "@vibecook/ice/desk";
import { deskPalette, minimatKind } from "@vibecook/ice/desk/objects";
import { describe, expect, it } from "vitest";
import { SUITE_BOARD_FACE_UNTITLED } from "./suiteBoardFace";
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
  SUITE_BOARD_VINYLS,
  SuiteBoard,
  type SuiteBoardFace,
  suiteBoardSpawn,
} from "./suiteBoardKind";
import { suitePalette } from "./suitePen";

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

  it("should be selectable, movable and resizable, snapped both ways", () => {
    expect(SUITE_BOARD_INTERACTION).toEqual({
      selectable: true,
      movable: true,
      resizable: true,
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
      // `selectedEntities` runs its own query, which walks `.each`; nothing is
      // selected here.
      query: () => ({ each: () => {} }),
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
    // The mat is the Board's body, so the DOM box itself stays hidden; the name
    // is drawn anyway — nothing is selected here (ADR-0043).
    expect(painted?.style.display).toBe("none");
    const title = container.querySelector<HTMLElement>('[data-testid="suite-board-face__title"]');
    expect(title?.style.display).toBe("flex");
    expect(title?.dataset.selected).toBe("false");
    expect(title?.textContent).toContain(SUITE_BOARD_FACE_UNTITLED);
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
        vinyl: "board-rose",
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

  it("should give every board colour a material of its own", () => {
    const vinyls = new Set<string>();
    for (const color of boardColors) {
      const vinyl = boardVinyl(color);
      expect(vinyl).toBe(SUITE_BOARD_VINYL_BY_COLOR[color]);
      vinyls.add(vinyl);
    }
    // Six colours, six mats: two Boards of different colours must never be
    // drawn on the same material (ADR-0043).
    expect(vinyls.size).toBe(boardColors.length);
    for (const vinyl of vinyls) {
      expect(SUITE_BOARD_VINYLS as readonly string[]).toContain(vinyl);
    }
    expect(boardVinyl("not-a-colour")).toBe("sage");
    expect(boardVinyl(undefined)).toBe("sage");
  });

  it("should hand the mat program a distinct colour for every board vinyl", () => {
    // The names being distinct is not enough: the mat resolves its vinyl through
    // the palette's `theme()`, so each name must reach the program as its own
    // colour. This is the path the GPU actually takes (`looksOf` → `theme`).
    const palette = suitePalette(deskPalette("light"));
    const look = minimatKind().theme?.(kindPalette(palette), "light");
    const inks = new Set<string>();
    for (const color of boardColors) {
      const name = SUITE_BOARD_VINYL_BY_COLOR[color];
      expect(palette.vinyls[name]).toBeDefined();
      const rgb = look?.vinyls[name];
      expect(rgb).toBeDefined();
      inks.add(JSON.stringify(rgb));
    }
    expect(inks.size).toBe(boardColors.length);
  });
});
