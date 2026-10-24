import type { Component, Entity, World } from "@vibecook/ice";
import { describe, expect, it } from "vitest";
import {
  cardFaceFor,
  cardIdOf,
  frameBoardOf,
  identityOf,
  identitySlots,
  matBoardOf,
} from "./iceEntityIdentity";
import { SUITE_BOARD_FACE, SUITE_BOARD_TYPE } from "./suiteBoardKind";
import { SUITE_CARD_RUNGS, SUITE_CARD_TYPE } from "./suiteCardKind";

/** The base rung's face; a larger rung has its own component on purpose. */
const BASE_FACE = SUITE_CARD_RUNGS[0]?.face as Component<unknown>;
const SMALL = SUITE_CARD_RUNGS.find((rung) => rung.scale === 0.5);
const SMALL_FACE = SMALL?.face as Component<unknown> | undefined;
const SMALL_TYPE = SMALL?.type ?? "suite.card@0.5";

interface FakeEntity {
  type?: string | undefined;
  face?: Record<string, unknown> | undefined;
  board?: Record<string, unknown> | undefined;
  parent?: Entity | undefined;
  alive?: boolean | undefined;
}

/**
 * A world that answers the four reads the resolver makes. Cast rather than
 * shaped: the resolver only ever calls these members, and a fake ECS would
 * hide which of them it depends on.
 */
function fakeWorld(entities: Record<number, FakeEntity>): World {
  const readFace = (entity: number, component: Component<unknown>) => {
    const entry = entities[entity];
    if (entry === undefined) return undefined;
    if (component === BASE_FACE) return entry.face;
    if (SMALL_FACE !== undefined && component === SMALL_FACE) return entry.face;
    if (component === (SUITE_BOARD_FACE as unknown as Component<unknown>)) return entry.board;
    return undefined;
  };
  const world = {
    isAlive: (entity: number) => entities[entity]?.alive !== false,
    has: (entity: number, component: Component<unknown>) =>
      readFace(entity, component) !== undefined,
    read: (entity: number, component: Component<unknown>) => {
      if ((component as { name?: string }).name === "PrefabId") {
        const type = entities[entity]?.type;
        if (type === undefined) throw new Error('strata: component "PrefabId" is not present');
        return { id: type };
      }
      return readFace(entity, component);
    },
    // The resolver only walks `ChildOf`; a fake relation table would hide that.
    getRelation: (entity: number) => entities[entity]?.parent,
  };
  return world as unknown as World;
}

describe("entity identity", () => {
  it("should read the card a rung's face names", () => {
    const world = fakeWorld({
      7: {
        type: SUITE_CARD_TYPE,
        face: { title: "A", body: "", cardId: "card-a", boardId: "b-1" },
      },
    });
    expect(cardIdOf(world, 7 as Entity)).toEqual({ cardId: "card-a", boardId: "b-1" });
  });

  it("should resolve a card on a rung other than the base one", () => {
    const world = fakeWorld({
      9: { type: SMALL_TYPE, face: { title: "B", body: "", cardId: "card-b", boardId: "b-2" } },
    });
    expect(cardFaceFor(SMALL_TYPE)).toBeDefined();
    expect(cardIdOf(world, 9 as Entity)).toEqual({ cardId: "card-b", boardId: "b-2" });
  });

  it("should answer nothing for a mat, a dead entity or an empty face", () => {
    const world = fakeWorld({
      1: { type: SUITE_BOARD_TYPE, board: { boardId: "board-x" } },
      2: { type: SUITE_CARD_TYPE, face: { cardId: "" }, alive: false },
      3: { type: SUITE_CARD_TYPE, face: { cardId: "  " } },
      4: { type: "desk.note" },
    });
    expect(cardIdOf(world, 1 as Entity)).toBeNull();
    expect(cardIdOf(world, 2 as Entity)).toBeNull();
    expect(cardIdOf(world, 3 as Entity)).toBeNull();
    expect(cardIdOf(world, 4 as Entity)).toBeNull();
  });

  it("should read the Board a mat stands for", () => {
    const world = fakeWorld({ 5: { type: SUITE_BOARD_TYPE, board: { boardId: "board-y" } } });
    expect(matBoardOf(world, 5 as Entity)).toBe("board-y");
    expect(identityOf(world, 5 as Entity)).toEqual({ cardId: null, boardId: "board-y" });
    expect(matBoardOf(world, 6 as Entity)).toBeNull();
  });

  it("should walk to the Board whose inside holds an entity", () => {
    const world = fakeWorld({
      10: {
        type: SUITE_CARD_TYPE,
        face: { cardId: "card-c", boardId: "board-z" },
        parent: 11 as Entity,
      },
      11: { type: SUITE_BOARD_TYPE, board: { boardId: "board-z" }, parent: 12 as Entity },
      12: { parent: undefined },
      13: {
        type: SUITE_CARD_TYPE,
        face: { cardId: "card-d", boardId: "board-1" },
        parent: 12 as Entity,
      },
    });
    expect(frameBoardOf(world, 10 as Entity)).toBe("board-z");
    expect(frameBoardOf(world, 11 as Entity)).toBeNull();
    expect(frameBoardOf(world, 13 as Entity)).toBeNull();
  });
});

describe("identitySlots", () => {
  it("should answer the seed's slot first and resolve the rest", () => {
    const world = fakeWorld({
      1: { type: SUITE_CARD_TYPE, face: { cardId: "seeded", boardId: "b-1" } },
      2: { type: SUITE_CARD_TYPE, face: { cardId: "engine-made", boardId: "b-2" } },
      3: { type: "desk.note" },
    });
    const base = new Map([[1 as Entity, { cardId: "seeded", boardId: "b-1" }]]);
    const slots = identitySlots(base, world);
    expect(slots.get(1 as Entity)).toEqual({ cardId: "seeded", boardId: "b-1" });
    expect(slots.get(2 as Entity)).toEqual({ cardId: "engine-made", boardId: "b-2" });
    expect(slots.get(3 as Entity)).toBeUndefined();
    expect(slots.has(2 as Entity)).toBe(true);
    expect([...slots].map(([entity]) => entity)).toEqual([1]);
    expect(slots.size).toBe(1);
  });
});
