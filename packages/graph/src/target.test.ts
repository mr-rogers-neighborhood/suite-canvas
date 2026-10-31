import { describe, expect, it } from "vitest";
import type { Target } from "./target.js";
import { sameTarget, targetKey, targetKindSchema, targetKinds, targetSchema } from "./target.js";

describe("targetSchema", () => {
  it("accepts every kind it declares", () => {
    for (const kind of targetKinds) {
      expect(targetSchema.parse({ kind, id: "thing-1" })).toEqual({ kind, id: "thing-1" });
    }
  });

  it("rejects an unknown kind", () => {
    expect(targetKindSchema.safeParse("widget").success).toBe(false);
    expect(targetSchema.safeParse({ kind: "widget", id: "thing-1" }).success).toBe(false);
  });

  it("rejects an empty or missing id", () => {
    expect(targetSchema.safeParse({ kind: "card", id: "" }).success).toBe(false);
    expect(targetSchema.safeParse({ kind: "card" }).success).toBe(false);
  });

  it("accepts a UI region id, which is the one kind not minted by the document", () => {
    expect(targetSchema.parse({ kind: "ui", id: "title-bar" })).toEqual({
      kind: "ui",
      id: "title-bar",
    });
  });
});

describe("targetKey", () => {
  it("keeps the kind so two objects with the same id stay distinct", () => {
    expect(targetKey({ kind: "card", id: "1" })).toBe("card:1");
    expect(targetKey({ kind: "board", id: "1" })).toBe("board:1");
    expect(targetKey({ kind: "card", id: "1" })).not.toBe(targetKey({ kind: "section", id: "1" }));
  });
});

describe("sameTarget", () => {
  it("is true for the same kind and id", () => {
    const left: Target = { kind: "link", id: "edge-1" };
    expect(sameTarget(left, { kind: "link", id: "edge-1" })).toBe(true);
  });

  it("is false when either the kind or the id differs", () => {
    const left: Target = { kind: "card", id: "card-1" };
    expect(sameTarget(left, { kind: "section", id: "card-1" })).toBe(false);
    expect(sameTarget(left, { kind: "card", id: "card-2" })).toBe(false);
  });
});
