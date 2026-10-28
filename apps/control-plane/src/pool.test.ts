import { describe, expect, it } from "vitest";
import { createPool } from "./pool.js";

describe("createPool", () => {
  it("should attach an error listener so an idle client cannot kill the process", () => {
    const pool = createPool({ connectionString: "postgres://user:pass@127.0.0.1:1/none" });

    // `pg` emits `error` when a connection dies while idle; an emitted error with no
    // listener is an uncaught exception, so the count is the safety property.
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    void pool.end();
  });

  it("should hand the error to the caller's handler when one is given", () => {
    const seen: unknown[] = [];
    const pool = createPool(
      { connectionString: "postgres://user:pass@127.0.0.1:1/none" },
      (error) => seen.push(error),
    );

    pool.emit("error", new Error("Connection terminated unexpectedly"));

    expect(seen).toHaveLength(1);
    void pool.end();
  });
});
