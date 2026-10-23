import { describe, expect, it } from "vitest";
import type { TypeGraph, TypeGraphCardInput, TypeGraphInput, TypeGraphNode } from "./typeGraph.js";
import {
  buildTypeGraph,
  GRAPH_BAND,
  isGraphBand,
  LOOSE_CONTAINER_LABEL,
  looseContainerKey,
} from "./typeGraph.js";
import type { ScenePlacementInput, SceneSectionInput } from "./types.js";

const BOARD = "b1";
const OTHER_BOARD = "b2";

const NOTE = { id: "note", name: "Note", glyph: "N" } as const;
const IMAGE = { id: "image", name: "Image", glyph: "I", color: "#f0f" } as const;

function card(id: string, primaryTypeId: string = NOTE.id): TypeGraphCardInput {
  return { id, primaryTypeId };
}

function place(
  cardId: string,
  x: number,
  y: number,
  extra: { boardId?: string; width?: number; height?: number } = {},
): ScenePlacementInput {
  const placement: ScenePlacementInput = {
    boardId: extra.boardId ?? BOARD,
    cardId,
    x,
    y,
    z: 0,
  };
  if (extra.width === undefined || extra.height === undefined) return placement;
  return { ...placement, width: extra.width, height: extra.height };
}

function frame(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<SceneSectionInput> = {},
): SceneSectionInput {
  return { id, boardId: BOARD, title: id, x, y, width, height, z: 0, ...extra };
}

function graphOf(overrides: Partial<TypeGraphInput> = {}): TypeGraph {
  return buildTypeGraph({
    boardId: BOARD,
    cards: [card("n1")],
    placements: [place("n1", 0, 0)],
    sections: [],
    types: [NOTE],
    ...overrides,
  });
}

function findNode(graph: TypeGraph, key: string): TypeGraphNode {
  const node = graph.nodes.find((entry) => entry.key === key);
  if (node === undefined) throw new Error(`missing node ${key}`);
  return node;
}

function keysOf(graph: TypeGraph): string[] {
  return graph.nodes.map((node) => node.key);
}

/** node key -> rounded position, so two graphs can be compared by placement. */
function positions(graph: TypeGraph): Record<string, readonly number[]> {
  const result: Record<string, readonly number[]> = {};
  for (const node of graph.nodes) {
    result[node.key] = [node.x, node.y, node.width, node.height];
  }
  return result;
}

/**
 * A two-level board: `s-outer` holds one note directly, `s-inner` (nested in it)
 * holds a note and an image.
 */
function nestedInput(): TypeGraphInput {
  return {
    boardId: BOARD,
    cards: [card("n1"), card("n2"), card("i1", IMAGE.id)],
    placements: [
      place("n1", 10, 10, { width: 20, height: 20 }),
      place("n2", 210, 210, { width: 20, height: 20 }),
      place("i1", 250, 250, { width: 20, height: 20 }),
    ],
    sections: [frame("s-outer", 0, 0, 1000, 1000), frame("s-inner", 200, 200, 300, 300)],
    types: [NOTE, IMAGE],
  };
}

describe("buildTypeGraph determinism", () => {
  it("should produce deep-equal output for identical input", () => {
    const input = nestedInput();
    expect(buildTypeGraph(input)).toEqual(buildTypeGraph(input));
  });

  it("should not depend on placement order", () => {
    const input = nestedInput();
    const reversed = { ...input, placements: [...input.placements].reverse() };
    const forward = buildTypeGraph(input);
    const backward = buildTypeGraph(reversed);
    expect(keysOf(backward)).toEqual(keysOf(forward));
    expect(positions(backward)).toEqual(positions(forward));
    expect(backward).toEqual(forward);
  });

  it("should not depend on section order", () => {
    const input = nestedInput();
    const reversed = { ...input, sections: [...input.sections].reverse() };
    expect(buildTypeGraph(reversed)).toEqual(buildTypeGraph(input));
  });

  it("should not depend on card or type order", () => {
    const input = nestedInput();
    const shuffled = {
      ...input,
      cards: [...input.cards].reverse(),
      types: [...input.types].reverse(),
    };
    expect(buildTypeGraph(shuffled)).toEqual(buildTypeGraph(input));
  });
});

describe("buildTypeGraph container resolution", () => {
  it("should place a card in the smallest section that contains its centre", () => {
    const graph = buildTypeGraph(nestedInput());

    expect(findNode(graph, "type:s-inner:note").count).toBe(1);
    expect(findNode(graph, "type:s-inner:image").count).toBe(1);
    expect(findNode(graph, "type:s-outer:note").count).toBe(1);
    expect(graph.nodes.some((node) => node.key === "type:s-inner:note" && node.count === 2)).toBe(
      false,
    );
  });

  it("should break equal-area ties on the section id", () => {
    // Identical frames: both contain the card, so only the id can decide.
    const graph = graphOf({
      sections: [frame("s-b", 100, 100, 200, 200), frame("s-a", 100, 100, 200, 200)],
      placements: [place("n1", 150, 150, { width: 10, height: 10 })],
    });

    expect(keysOf(graph)).toEqual(["container:s-a", "type:s-a:note"]);
  });

  it("should ignore sections owned by another board", () => {
    const graph = graphOf({
      sections: [frame("s-other", 0, 0, 100, 100, { boardId: OTHER_BOARD })],
      placements: [place("n1", 10, 10)],
    });

    expect(keysOf(graph)).toEqual([looseContainerKey(BOARD), `type:__loose__:${BOARD}:note`]);
  });

  it("should drop sections that hold no cards", () => {
    const graph = graphOf({ sections: [frame("s-empty", 500, 500, 100, 100)] });
    expect(keysOf(graph)).toEqual([looseContainerKey(BOARD), `type:__loose__:${BOARD}:note`]);
  });
});

describe("buildTypeGraph loose bucket", () => {
  it("should collect cards outside every section in one bucket per board", () => {
    const graph = graphOf({
      cards: [card("n1"), card("n2"), card("i1", IMAGE.id)],
      placements: [
        place("n1", 0, 0, { width: 20, height: 20 }),
        place("n2", 40, 0, { width: 20, height: 20 }),
        place("i1", 80, 0, { width: 20, height: 20 }),
      ],
    });

    const containers = graph.nodes.filter((node) => node.kind === "container");
    expect(containers).toHaveLength(1);
    expect(containers[0]?.key).toBe(looseContainerKey(BOARD));
    expect(containers[0]?.containerId).toBeNull();
    expect(containers[0]?.label).toBe(LOOSE_CONTAINER_LABEL);
    expect(containers[0]?.count).toBe(3);
    expect(containers[0]?.depth).toBe(0);
  });

  it("should key the bucket by board and leave other boards empty", () => {
    const input: TypeGraphInput = {
      boardId: OTHER_BOARD,
      cards: [card("n1")],
      placements: [place("n1", 0, 0, { boardId: OTHER_BOARD })],
      sections: [],
      types: [NOTE],
    };
    const other = buildTypeGraph(input);
    expect(keysOf(other)).toEqual([
      looseContainerKey(OTHER_BOARD),
      `type:__loose__:${OTHER_BOARD}:note`,
    ]);
    expect(other.counted).toBe(1);
  });
});

describe("buildTypeGraph placement filtering", () => {
  it("should ignore placements on another board", () => {
    const graph = graphOf({ placements: [place("n1", 0, 0, { boardId: OTHER_BOARD })] });
    expect(graph.nodes).toEqual([]);
    expect(graph.counted).toBe(0);
    expect(graph.skipped).toBe(0);
  });

  it("should skip a placement whose card record is missing", () => {
    const graph = graphOf({
      cards: [card("n1")],
      placements: [place("n1", 0, 0), place("ghost", 100, 100)],
    });

    expect(graph.counted).toBe(1);
    expect(graph.skipped).toBe(1);
    expect(findNode(graph, `type:__loose__:${BOARD}:note`).count).toBe(1);
  });

  it("should not count a missing card as a loose container on its own", () => {
    const graph = graphOf({
      cards: [],
      placements: [place("ghost", 0, 0)],
    });

    expect(graph.nodes).toEqual([]);
    expect(graph.counted).toBe(0);
    expect(graph.skipped).toBe(1);
  });

  it("should ignore cards that have no placement", () => {
    const graph = graphOf({ cards: [card("n1"), card("n2")] });
    expect(graph.counted).toBe(1);
    expect(graph.skipped).toBe(0);
  });
});

describe("buildTypeGraph clusters", () => {
  it("should emit one type node per (container, type) with the right counts", () => {
    const graph = graphOf({
      cards: [card("n1"), card("n2"), card("i1", IMAGE.id)],
      placements: [
        place("n1", 0, 0, { width: 20, height: 20 }),
        place("n2", 40, 0, { width: 20, height: 20 }),
        place("i1", 80, 0, { width: 20, height: 20 }),
      ],
    });

    const types = graph.nodes.filter((node) => node.kind === "type");
    expect(types).toHaveLength(2);
    expect(findNode(graph, `type:__loose__:${BOARD}:note`).count).toBe(2);
    expect(findNode(graph, `type:__loose__:${BOARD}:image`).count).toBe(1);

    const container = findNode(graph, looseContainerKey(BOARD));
    expect(container.count).toBe(3);
    expect(types.reduce((sum, node) => sum + node.count, 0)).toBe(container.count);
  });

  it("should carry the type label, glyph and colour, and fall back when the type is unknown", () => {
    const graph = graphOf({
      cards: [card("i1", IMAGE.id), card("u1", "ghost-type")],
      placements: [place("i1", 0, 0), place("u1", 200, 0)],
      types: [NOTE, IMAGE],
    });

    const image = findNode(graph, `type:__loose__:${BOARD}:image`);
    expect(image.label).toBe("Image");
    expect(image.glyph).toBe("I");
    expect(image.color).toBe("#f0f");

    const unknown = findNode(graph, `type:__loose__:${BOARD}:ghost-type`);
    expect(unknown.label).toBe("ghost-type");
    expect(unknown.glyph).toBe("\u25a1");
    expect(unknown.color).toBeUndefined();
  });

  it("should sum container counts to `counted`", () => {
    const graph = buildTypeGraph(nestedInput());
    const total = graph.nodes
      .filter((node) => node.kind === "container")
      .reduce((sum, node) => sum + node.count, 0);
    expect(total).toBe(graph.counted);
    expect(graph.counted).toBe(3);
    expect(graph.skipped).toBe(0);
  });
});

describe("buildTypeGraph edges", () => {
  it("should emit exactly one containment edge per type node", () => {
    const loose = graphOf({
      cards: [card("n1"), card("i1", IMAGE.id)],
      placements: [place("n1", 0, 0), place("i1", 300, 0)],
      types: [NOTE, IMAGE],
    });

    for (const graph of [buildTypeGraph(nestedInput()), loose]) {
      const types = graph.nodes.filter((node) => node.kind === "type");

      expect(graph.edges).toHaveLength(types.length);
      for (const node of types) {
        const edges = graph.edges.filter((edge) => edge.target === node.key);
        expect(edges).toHaveLength(1);
        const containerKey =
          node.containerId === null ? looseContainerKey(BOARD) : `container:${node.containerId}`;
        expect(edges[0]?.source).toBe(containerKey);
      }
    }
  });

  it("should not invent reference edges", () => {
    const graph = buildTypeGraph(nestedInput());
    const containerKeys = new Set(
      graph.nodes.filter((node) => node.kind === "container").map((node) => node.key),
    );
    const typeKeys = new Set(
      graph.nodes.filter((node) => node.kind === "type").map((node) => node.key),
    );

    for (const edge of graph.edges) {
      expect(containerKeys.has(edge.source)).toBe(true);
      expect(typeKeys.has(edge.target)).toBe(true);
    }
    expect(new Set(graph.edges.map((edge) => edge.key)).size).toBe(graph.edges.length);
  });
});

describe("buildTypeGraph depth", () => {
  it("should offset every depth by the input depth", () => {
    const flat = buildTypeGraph({ ...nestedInput(), depth: 2 });
    expect(findNode(flat, "container:s-outer").depth).toBe(2);
    expect(findNode(flat, "container:s-inner").depth).toBe(3);
    expect(findNode(flat, "type:s-outer:note").depth).toBe(3);
    expect(findNode(flat, "type:s-inner:note").depth).toBe(4);
  });

  it("should default the base depth to zero and give type nodes one more level", () => {
    const graph = buildTypeGraph(nestedInput());
    expect(findNode(graph, "container:s-outer").depth).toBe(0);
    expect(findNode(graph, "container:s-inner").depth).toBe(1);
    for (const node of graph.nodes.filter((entry) => entry.kind === "type")) {
      const container = findNode(graph, `container:${node.containerId ?? ""}`);
      expect(node.depth).toBe(container.depth + 1);
    }
  });

  it("should not nest the loose bucket", () => {
    const graph = graphOf({ depth: 1 });
    expect(findNode(graph, looseContainerKey(BOARD)).depth).toBe(1);
    expect(findNode(graph, `type:__loose__:${BOARD}:note`).depth).toBe(2);
  });
});

describe("buildTypeGraph layout", () => {
  it("should keep type cells inside a large frame", () => {
    const types = ["a", "b", "c", "d"].map((id) => ({ id, name: id, glyph: id }));
    const graph = graphOf({
      sections: [frame("s-big", 0, 0, 800, 600, { title: "Big" })],
      cards: types.map((type) => card(`c-${type.id}`, type.id)),
      placements: types.map((type, index) => place(`c-${type.id}`, index * 10, index * 10)),
      types,
    });

    const container = findNode(graph, "container:s-big");
    for (const node of graph.nodes.filter((entry) => entry.kind === "type")) {
      expect(node.x).toBeGreaterThanOrEqual(container.x);
      expect(node.y).toBeGreaterThanOrEqual(container.y);
      expect(node.x + node.width).toBeLessThanOrEqual(container.x + container.width);
      expect(node.y + node.height).toBeLessThanOrEqual(container.y + container.height);
    }
  });

  it("should lay the same grid out twice", () => {
    const input = nestedInput();
    expect(positions(buildTypeGraph(input))).toEqual(positions(buildTypeGraph(input)));
  });

  it("should stay finite in a frame too small for the grid", () => {
    const types = ["a", "b", "c", "d"].map((id) => ({ id, name: id, glyph: id }));
    const build = () =>
      graphOf({
        sections: [frame("s-tiny", 0, 0, 20, 10, { title: "Tiny" })],
        cards: types.map((type) => card(`c-${type.id}`, type.id)),
        placements: types.map((type, index) =>
          place(`c-${type.id}`, index * 4, 2, { width: 2, height: 2 }),
        ),
        types,
      });

    let graph: TypeGraph | undefined;
    expect(() => {
      graph = build();
    }).not.toThrow();
    if (graph === undefined) throw new Error("graph not built");

    expect(graph.nodes).toHaveLength(5);
    for (const node of graph.nodes) {
      for (const value of [node.x, node.y, node.width, node.height, node.depth]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
    }
  });

  it("should cover spilled cells with the bounds", () => {
    // Too small for a 2x2 grid: the cells clamp to their minimum and spill out
    // of the container, so bounds must follow the nodes, not just the frames.
    const types = ["a", "b", "c", "d"].map((id) => ({ id, name: id, glyph: id }));
    const graph = graphOf({
      sections: [frame("s-tiny", 0, 0, 20, 10, { title: "Tiny" })],
      cards: types.map((type) => card(`c-${type.id}`, type.id)),
      placements: types.map((type, index) =>
        place(`c-${type.id}`, index * 4, 2, { width: 2, height: 2 }),
      ),
      types,
    });

    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(graph.bounds.x);
      expect(node.y).toBeGreaterThanOrEqual(graph.bounds.y);
      expect(node.x + node.width).toBeLessThanOrEqual(graph.bounds.x + graph.bounds.width);
      expect(node.y + node.height).toBeLessThanOrEqual(graph.bounds.y + graph.bounds.height);
    }
  });

  it("should cover every node with the bounds", () => {
    for (const input of [nestedInput(), { ...nestedInput(), depth: 3 }]) {
      const graph = buildTypeGraph(input);
      for (const node of graph.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(graph.bounds.x);
        expect(node.y).toBeGreaterThanOrEqual(graph.bounds.y);
        expect(node.x + node.width).toBeLessThanOrEqual(graph.bounds.x + graph.bounds.width);
        expect(node.y + node.height).toBeLessThanOrEqual(graph.bounds.y + graph.bounds.height);
      }
    }
  });

  it("should return no nodes and empty bounds for an empty board", () => {
    const graph = buildTypeGraph({
      boardId: BOARD,
      cards: [],
      placements: [],
      sections: [frame("s-empty", 0, 0, 100, 100)],
      types: [],
    });

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(graph.counted).toBe(0);
    expect(graph.skipped).toBe(0);
  });
});

describe("isGraphBand", () => {
  const cases: readonly { zoom: number; was: boolean; expected: boolean; label: string }[] = [
    { zoom: 0.04, was: false, expected: true, label: "well inside on a cold camera" },
    { zoom: GRAPH_BAND.enter, was: false, expected: true, label: "enters at the enter threshold" },
    { zoom: 0.1201, was: false, expected: false, label: "just above enter, cold" },
    { zoom: 0.125, was: false, expected: false, label: "between the thresholds, cold" },
    { zoom: GRAPH_BAND.exit, was: true, expected: true, label: "stays at the exit threshold" },
    { zoom: 0.1301, was: true, expected: false, label: "leaves just past exit" },
    { zoom: 0.125, was: true, expected: true, label: "between the thresholds, warm" },
    { zoom: Number.NaN, was: true, expected: true, label: "NaN keeps the previous state" },
    { zoom: Number.NaN, was: false, expected: false, label: "NaN does not enter" },
    {
      zoom: Number.POSITIVE_INFINITY,
      was: true,
      expected: true,
      label: "infinite zoom keeps the previous state",
    },
    { zoom: 0, was: true, expected: true, label: "zero zoom keeps the previous state" },
    { zoom: -1, was: false, expected: false, label: "negative zoom does not enter" },
  ];

  it.each(cases)("should resolve $label ($zoom, was=$was)", ({ zoom, was, expected }) => {
    expect(isGraphBand(zoom, was)).toBe(expected);
  });

  it("should expose the documented thresholds", () => {
    expect(GRAPH_BAND).toEqual({ enter: 0.12, exit: 0.13 });
    // The enter threshold is the card cull threshold: no zoom range shows nothing.
    expect(GRAPH_BAND.enter).toBe(0.12);
  });

  it("should build the loose key per board", () => {
    expect(looseContainerKey("abc")).toBe("container:__loose__:abc");
  });
});
