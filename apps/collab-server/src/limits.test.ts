import { describe, expect, it } from "vitest";
import { HttpError } from "./http.js";
import {
  createQuotaService,
  createShareQuotaGuard,
  type Limits,
  limitsProblem,
  parseLimitOverrides,
  publicLimits,
  type QuotaOptions,
  readLimitOverrides,
  resolveLimits,
  SELF_HOSTED_DEFAULTS,
  shareBlockReason,
  workspaceUsages,
  writeLimitOverrides,
} from "./limits.js";
import { createDocumentStore } from "./persistence.js";
import { createSettingsStore } from "./settings.js";
import { createShareStore } from "./shares.js";

const MIB = 1024 * 1024;

function documentKey(roomId: string): string {
  return `%LOR:${roomId}`;
}

function stores(): {
  documents: ReturnType<typeof createDocumentStore>;
  shares: ReturnType<typeof createShareStore>;
} {
  return { documents: createDocumentStore(":memory:"), shares: createShareStore(":memory:") };
}

function quotaOptions(
  overrides: {
    limits: () => Limits;
    documents: ReturnType<typeof createDocumentStore>;
    shares: ReturnType<typeof createShareStore>;
    size?: number;
  } & Partial<Pick<QuotaOptions, "licenceBytes">>,
): QuotaOptions {
  const options: QuotaOptions = {
    documents: overrides.documents,
    shares: overrides.shares,
    limits: overrides.limits,
    size: () => overrides.size ?? 0,
  };
  if (overrides.licenceBytes) options.licenceBytes = overrides.licenceBytes;
  return options;
}

describe("limit resolution", () => {
  it("defaults to unlimited on a self-host and keeps the existing caps", () => {
    const resolved = resolveLimits({}, null);

    expect(resolved.limits).toEqual(SELF_HOSTED_DEFAULTS);
    expect(resolved.limits.maxWorkspaces).toBe(Number.POSITIVE_INFINITY);
    expect(resolved.limits.documentBytesPerWorkspace).toBe(Number.POSITIVE_INFINITY);
    expect(resolved.limits.projectionBytesPerWorkspace).toBe(Number.POSITIVE_INFINITY);
    expect(resolved.limits.attachmentBytesPerWorkspace).toBe(Number.POSITIVE_INFINITY);
    expect(resolved.limits.sharesPerWorkspace).toBe(100);
    expect(resolved.limits.selectionCards).toBe(200);
    expect(resolved.limits.diskSoftBytes).toBe(Number.POSITIVE_INFINITY);
    expect(resolved.limits.diskHardBytes).toBe(Number.POSITIVE_INFINITY);
    expect(Object.values(resolved.sources).every((source) => source === "default")).toBe(true);
    expect(resolved.problems).toEqual([]);
  });

  it("merges defaults ← env ← overrides, in that order", () => {
    const env = {
      SUITE_MAX_WORKSPACES: "10",
      SUITE_DOCUMENT_BYTES_PER_WORKSPACE: String(5 * MIB),
      SUITE_DISK_SOFT_BYTES: "1",
      SUITE_DISK_HARD_BYTES: "2",
    };
    const resolved = resolveLimits(env, {
      maxWorkspaces: 3,
      selectionCards: 50,
    });

    expect(resolved.limits.maxWorkspaces).toBe(3);
    expect(resolved.limits.documentBytesPerWorkspace).toBe(5 * MIB);
    expect(resolved.limits.selectionCards).toBe(50);
    expect(resolved.limits.sharesPerWorkspace).toBe(100);
    expect(resolved.sources.maxWorkspaces).toBe("override");
    expect(resolved.sources.documentBytesPerWorkspace).toBe("env");
    expect(resolved.sources.selectionCards).toBe("override");
    expect(resolved.sources.sharesPerWorkspace).toBe("default");
  });

  it("accepts the word unlimited in an env var", () => {
    const resolved = resolveLimits({ SUITE_MAX_WORKSPACES: "unlimited" }, { maxWorkspaces: 4 });
    expect(resolved.limits.maxWorkspaces).toBe(4);
    expect(resolveLimits({ SUITE_MAX_WORKSPACES: "unlimited" }, null).limits.maxWorkspaces).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("reports an unreadable env value and keeps the layer below it", () => {
    const resolved = resolveLimits({ SUITE_DOCUMENT_BYTES_PER_WORKSPACE: "five megabytes" }, null);

    expect(resolved.limits.documentBytesPerWorkspace).toBe(Number.POSITIVE_INFINITY);
    expect(resolved.problems).toHaveLength(1);
    expect(resolved.problems[0]).toContain("SUITE_DOCUMENT_BYTES_PER_WORKSPACE");
    expect(resolved.problems[0]).toContain("five megabytes");
  });

  it("reports a contradictory configuration so boot can fail fast", () => {
    const softAboveHard = resolveLimits(
      { SUITE_DISK_SOFT_BYTES: "10", SUITE_DISK_HARD_BYTES: "5" },
      null,
    ).limits;
    expect(limitsProblem(softAboveHard)).toContain("soft watermark");
    expect(limitsProblem(softAboveHard)).toContain("hard watermark");

    expect(limitsProblem(resolveLimits({}, null).limits)).toBeNull();
    expect(limitsProblem({ ...SELF_HOSTED_DEFAULTS, maxWorkspaces: -1 })).toContain(
      "maxWorkspaces",
    );
  });

  it("serializes infinity as null for JSON responses", () => {
    expect(publicLimits(SELF_HOSTED_DEFAULTS).maxWorkspaces).toBeNull();
    expect(publicLimits({ ...SELF_HOSTED_DEFAULTS, maxWorkspaces: 7 }).maxWorkspaces).toBe(7);
  });
});

describe("runtime overrides", () => {
  it("rejects unknown keys instead of silently ignoring a typo", () => {
    const parsed = parseLimitOverrides({ maxWorkspaces: 4, diskHardByte: 1 });
    expect(parsed.problem).toContain('Unknown limit "diskHardByte"');
    expect(parsed.changes).toEqual({});
  });

  it("accepts whole numbers, unlimited and null, and rejects the rest", () => {
    expect(parseLimitOverrides({ maxWorkspaces: 4 }).changes.maxWorkspaces).toBe(4);
    expect(parseLimitOverrides({ maxWorkspaces: null }).changes.maxWorkspaces).toBeNull();
    expect(parseLimitOverrides({ maxWorkspaces: "unlimited" }).changes.maxWorkspaces).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(parseLimitOverrides({ maxWorkspaces: -2 }).problem).toContain("maxWorkspaces");
    expect(parseLimitOverrides({ maxWorkspaces: 1.5 }).problem).toContain("maxWorkspaces");
    expect(parseLimitOverrides("nope").problem).toBe("Limit overrides must be a JSON object.");
  });

  it("round-trips through the settings store, including an unlimited override", () => {
    const settings = createSettingsStore();
    try {
      writeLimitOverrides(settings, { maxWorkspaces: 12, diskHardBytes: Number.POSITIVE_INFINITY });
      expect(readLimitOverrides(settings)).toEqual({
        maxWorkspaces: 12,
        diskHardBytes: Number.POSITIVE_INFINITY,
      });

      writeLimitOverrides(settings, { maxWorkspaces: 12 });
      expect(readLimitOverrides(settings)).toEqual({ maxWorkspaces: 12 });

      writeLimitOverrides(settings, {});
      expect(readLimitOverrides(settings)).toEqual({});
    } finally {
      settings.close();
    }
  });

  it("reads a corrupt row as no overrides", () => {
    const settings = createSettingsStore();
    try {
      settings.set("limits.overrides", "{not json");
      expect(readLimitOverrides(settings)).toEqual({});
    } finally {
      settings.close();
    }
  });
});

describe("workspace quotas", () => {
  it("sums a workspace's document and its active share projections in one pass", () => {
    const { documents, shares } = stores();
    try {
      const { share } = shares.create({
        workspaceId: "ws-1",
        scope: "card",
        role: "viewer",
        cardId: "c1",
      });
      const roomId = share.roomId ?? "";
      expect(roomId.startsWith("share-")).toBe(true);

      documents.save(documentKey("ws-1"), new Uint8Array(100));
      documents.save(documentKey(roomId), new Uint8Array(40));
      documents.save(documentKey("ws-2"), new Uint8Array(7));

      const usages = workspaceUsages({ documents, shares }, ["ws-1", "ws-2"]);
      expect(usages.get("ws-1")).toEqual({
        documentBytes: 100,
        projectionBytes: 40,
        activeShares: 1,
      });
      expect(usages.get("ws-2")).toEqual({
        documentBytes: 7,
        projectionBytes: 0,
        activeShares: 0,
      });
    } finally {
      documents.close();
      shares.close();
    }
  });

  it("marks a workspace over quota when the stored document passes its budget", () => {
    const { documents, shares } = stores();
    try {
      documents.save(documentKey("ws-1"), new Uint8Array(2048));
      const quotas = createQuotaService(
        quotaOptions({
          documents,
          shares,
          limits: () => resolveLimits({ SUITE_DOCUMENT_BYTES_PER_WORKSPACE: "1024" }, null).limits,
        }),
      );
      const quota = quotas.workspace("ws-1");
      expect(quota.documentBytes).toBe(2048);
      expect(quota.documentBudget).toBe(1024);
      expect(quota.overQuota).toBe(true);
      expect(quota.sharesAllowed).toBe(false);
    } finally {
      documents.close();
      shares.close();
    }
  });

  it("never drops a save, and only refuses the new share", () => {
    const { documents, shares } = stores();
    try {
      const limits = resolveLimits({ SUITE_DOCUMENT_BYTES_PER_WORKSPACE: "10" }, null).limits;
      const quotas = createQuotaService(quotaOptions({ documents, shares, limits: () => limits }));
      const guarded = createShareQuotaGuard(shares, quotas);

      // The save that crosses the budget lands, and reads back unchanged.
      const first = new TextEncoder().encode("x".repeat(200));
      documents.save(documentKey("ws-1"), first);
      expect(documents.load(documentKey("ws-1"))).toEqual(first);
      expect(quotas.workspace("ws-1").overQuota).toBe(true);

      // The next share is refused, naming the reason and the current total.
      let refusal: unknown;
      try {
        guarded.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(HttpError);
      const httpError = refusal as HttpError;
      expect(httpError.status).toBe(409);
      expect(httpError.message).toContain("over its document budget");
      expect(httpError.message).toContain("200 B of 10 B");
      expect(httpError.message).toContain("Your edits are still saved");
      expect(shares.countActive("ws-1")).toBe(0);

      // Editing continues after the refusal: the save path is untouched.
      const second = new TextEncoder().encode("y".repeat(400));
      documents.save(documentKey("ws-1"), second);
      expect(documents.load(documentKey("ws-1"))).toEqual(second);
    } finally {
      documents.close();
      shares.close();
    }
  });

  it("refuses a new share once the projections reach their budget", () => {
    const { documents, shares } = stores();
    try {
      const limits = resolveLimits(
        { SUITE_PROJECTION_BYTES_PER_WORKSPACE: String(1000) },
        null,
      ).limits;
      const quotas = createQuotaService(quotaOptions({ documents, shares, limits: () => limits }));
      const guarded = createShareQuotaGuard(shares, quotas);

      const { share } = guarded.create({
        workspaceId: "ws-1",
        scope: "board",
        role: "viewer",
        boardId: "b1",
      });
      expect(share.roomId).not.toBeNull();
      // The first link fits under the budget.
      documents.save(documentKey(share.roomId ?? ""), new Uint8Array(1000));

      expect(() =>
        guarded.create({ workspaceId: "ws-1", scope: "board", role: "viewer", boardId: "b1" }),
      ).toThrowError(/shared projections use 1000 B of a 1000 B budget/);
      expect(shares.countActive("ws-1")).toBe(1);
    } finally {
      documents.close();
      shares.close();
    }
  });

  it("keeps the link cap tunable and names it in the refusal", () => {
    const { documents, shares } = stores();
    try {
      const limits = resolveLimits({ SUITE_MAX_SHARES_PER_WORKSPACE: "1" }, null).limits;
      const quotas = createQuotaService(quotaOptions({ documents, shares, limits: () => limits }));
      const guarded = createShareQuotaGuard(shares, quotas);
      guarded.create({ workspaceId: "ws-1", scope: "board", role: "viewer", boardId: "b1" });

      expect(() =>
        guarded.create({ workspaceId: "ws-1", scope: "board", role: "viewer", boardId: "b1" }),
      ).toThrowError(/already has 1 active links, its limit is 1/);
    } finally {
      documents.close();
      shares.close();
    }
  });

  it("takes the tighter of the instance limit and a licence budget", () => {
    const { documents, shares } = stores();
    try {
      documents.save(documentKey("ws-1"), new Uint8Array(3000));
      const quotas = createQuotaService(
        quotaOptions({
          documents,
          shares,
          limits: () => resolveLimits({}, null).limits,
          licenceBytes: () => ({ documentBytes: 2048 }),
        }),
      );
      expect(quotas.documentBudget("ws-1")).toBe(2048);
      expect(quotas.workspace("ws-1").overQuota).toBe(true);
    } finally {
      documents.close();
      shares.close();
    }
  });

  it("caps a selection share at the tunable card limit", () => {
    const { documents, shares } = stores();
    try {
      const limits = resolveLimits({ SUITE_MAX_SELECTION_CARDS: "2" }, null).limits;
      const quotas = createQuotaService(quotaOptions({ documents, shares, limits: () => limits }));
      const guarded = createShareQuotaGuard(shares, quotas);

      expect(() =>
        guarded.create({
          workspaceId: "ws-1",
          scope: "selection",
          role: "viewer",
          boardId: "b1",
          cardIds: ["c1", "c2", "c3"],
        }),
      ).toThrowError(/at most 2 cards/);
    } finally {
      documents.close();
      shares.close();
    }
  });

  it("allows shares again once the projection budget is free", () => {
    const { documents, shares } = stores();
    try {
      const limits = resolveLimits({ SUITE_PROJECTION_BYTES_PER_WORKSPACE: "10" }, null).limits;
      const quotas = createQuotaService(quotaOptions({ documents, shares, limits: () => limits }));
      const { share } = shares.create({
        workspaceId: "ws-1",
        scope: "board",
        role: "viewer",
        boardId: "b1",
      });
      documents.save(documentKey(share.roomId ?? ""), new Uint8Array(20));
      expect(shareBlockReason(quotas.workspace("ws-1"), limits)?.status).toBe(507);

      shares.revoke(share.id);
      expect(shareBlockReason(quotas.workspace("ws-1"), limits)).toBeNull();
    } finally {
      documents.close();
      shares.close();
    }
  });
});
