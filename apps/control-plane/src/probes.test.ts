import { describe, expect, it } from "vitest";
import { DATABASE_CHECK, databaseProbe } from "./probes.js";

describe("database probe", () => {
  it("should answer ok when the round trip succeeds", async () => {
    const asked: string[] = [];
    const probe = databaseProbe({
      url: "postgres://unused",
      query: async (sql) => {
        asked.push(sql);
        return { rows: [{ "?column?": 1 }] };
      },
    });

    expect(await probe.check()).toEqual({ name: DATABASE_CHECK, state: "ok" });
    expect(asked).toEqual(["SELECT 1"]);
  });

  it("should answer failed with the reason rather than throwing", async () => {
    const probe = databaseProbe({
      url: "postgres://unused",
      query: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      },
    });

    expect(await probe.check()).toEqual({
      name: DATABASE_CHECK,
      state: "failed",
      detail: "connect ECONNREFUSED 10.0.0.5:5432",
    });
  });

  it("should answer failed when the socket hangs past the timeout", async () => {
    const probe = databaseProbe({
      url: "postgres://unused",
      timeoutMs: 10,
      query: () => new Promise(() => {}),
    });

    const check = await probe.check();

    expect(check.state).toBe("failed");
    expect(check.detail).toContain("10ms");
  });

  it("should recover once the database answers again", async () => {
    let reachable = false;
    const probe = databaseProbe({
      url: "postgres://unused",
      query: async () => {
        if (!reachable) throw new Error("down");
        return { rows: [] };
      },
    });

    expect((await probe.check()).state).toBe("failed");
    reachable = true;
    expect((await probe.check()).state).toBe("ok");
  });
});
