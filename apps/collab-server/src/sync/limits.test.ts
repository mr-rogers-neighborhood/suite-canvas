import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_PEERS_PER_ROOM,
  DEFAULT_ROOM_OUTSTANDING,
  joinRefusal,
  LIMIT_CODES,
  limitRoomOf,
  peersPerRoomLimit,
  RoomWorkBudget,
  roomOutstandingLimit,
} from "./limits.js";

/** Every refusal names its limit, the current value and the variable that sets it. */
function expectActionable(message: string, variable: string): void {
  expect(message).toContain(variable);
  expect(message.length).toBeGreaterThan(60);
}

describe("peers per room", () => {
  it("refuses a join at the cap with a named code", () => {
    const refusal = joinRefusal("share-token", {
      peers: 64,
      documentBytes: 1024,
      documentBudget: Number.POSITIVE_INFINITY,
      peerLimit: 64,
    });

    expect(refusal?.code).toBe(LIMIT_CODES.peers);
    expectActionable(refusal?.message ?? "", "SUITE_MAX_PEERS_PER_ROOM");
  });

  it("allows a join below the cap and when the count cannot be read", () => {
    const base = {
      documentBytes: 1024,
      documentBudget: Number.POSITIVE_INFINITY,
      peerLimit: 4,
    };
    expect(joinRefusal("ws-1", { ...base, peers: 3 })).toBeNull();
    // "Cannot tell" is not proof of a breach: a false refusal locks a reader out.
    expect(joinRefusal("ws-1", { ...base, peers: null })).toBeNull();
  });

  it("reads the cap from the environment and ignores a value it cannot use", () => {
    expect(peersPerRoomLimit({})).toBe(DEFAULT_MAX_PEERS_PER_ROOM);
    expect(peersPerRoomLimit({ SUITE_MAX_PEERS_PER_ROOM: "8" })).toBe(8);
    expect(peersPerRoomLimit({ SUITE_MAX_PEERS_PER_ROOM: "0" })).toBe(DEFAULT_MAX_PEERS_PER_ROOM);
    expect(peersPerRoomLimit({ SUITE_MAX_PEERS_PER_ROOM: "lots" })).toBe(
      DEFAULT_MAX_PEERS_PER_ROOM,
    );
  });
});

describe("document ceiling", () => {
  const facts = {
    peers: 0,
    peerLimit: 64,
  };

  it("refuses a join when the stored document is over its budget", () => {
    const refusal = joinRefusal("ws-1", { ...facts, documentBytes: 4096, documentBudget: 2048 });

    expect(refusal?.code).toBe(LIMIT_CODES.document);
    expectActionable(refusal?.message ?? "", "SUITE_DOCUMENT_BYTES_PER_WORKSPACE");
    // The bytes are kept: the refusal is about serving the document, not about
    // deleting it, so the message has to say what the operator can do.
    expect(refusal?.message).toContain("export");
  });

  it("allows a document at its budget, an unsaved room, and an unlimited budget", () => {
    expect(joinRefusal("ws-1", { ...facts, documentBytes: 2048, documentBudget: 2048 })).toBeNull();
    expect(joinRefusal("ws-1", { ...facts, documentBytes: null, documentBudget: 1 })).toBeNull();
    expect(
      joinRefusal("ws-1", {
        ...facts,
        documentBytes: 10 * 1024 * 1024,
        documentBudget: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull();
  });

  it("counts a presence room as the room it describes", () => {
    expect(limitRoomOf("share-abc:presence")).toBe("share-abc");
    expect(limitRoomOf("share-abc:cursors")).toBe("share-abc");
    expect(limitRoomOf("ws-1")).toBe("ws-1");
  });

  it("reports peers before the document ceiling, because it is the cheaper answer", () => {
    const refusal = joinRefusal("ws-1", {
      peers: 8,
      peerLimit: 8,
      documentBytes: 4096,
      documentBudget: 2048,
    });
    expect(refusal?.code).toBe(LIMIT_CODES.peers);
  });
});

describe("per-room backpressure", () => {
  it("counts outstanding work per room and reports the bound", () => {
    const budget = new RoomWorkBudget(2);
    expect(budget.atLimit("ws-1")).toBe(false);
    budget.enter("ws-1");
    budget.enter("ws-1");
    expect(budget.atLimit("ws-1")).toBe(true);
    // Another room is unaffected: one busy board degrades itself, not the rest.
    expect(budget.atLimit("ws-2")).toBe(false);

    budget.leave("ws-1");
    expect(budget.atLimit("ws-1")).toBe(false);
    budget.leave("ws-1");
    budget.leave("ws-1");
    expect(budget.inFlight("ws-1")).toBe(0);
    expect(budget.rooms()).toBe(0);
  });

  it("never drops below zero, so a doubled leave cannot free another task's slot", () => {
    const budget = new RoomWorkBudget(1);
    budget.enter("ws-1");
    budget.leave("ws-1");
    budget.leave("ws-1");
    expect(budget.inFlight("ws-1")).toBe(0);
  });

  it("reads the bound from the environment and ignores a value it cannot use", () => {
    expect(roomOutstandingLimit({})).toBe(DEFAULT_ROOM_OUTSTANDING);
    expect(roomOutstandingLimit({ SUITE_ROOM_OUTSTANDING_MAX: "3" })).toBe(3);
    expect(roomOutstandingLimit({ SUITE_ROOM_OUTSTANDING_MAX: "-2" })).toBe(
      DEFAULT_ROOM_OUTSTANDING,
    );
    expect(new RoomWorkBudget(0).limit).toBe(1);
  });
});

describe("refusal codes", () => {
  it("are stable strings, because logs and docs point at them", () => {
    expect(LIMIT_CODES).toEqual({
      peers: "peer-limit",
      document: "document-limit",
      cards: "card-limit",
      backpressure: "room-backpressure",
      projectionBuild: "projection-build-limit",
    });
  });
});
