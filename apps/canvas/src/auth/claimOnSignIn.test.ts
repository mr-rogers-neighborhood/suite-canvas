import { describe, expect, it, vi } from "vitest";
import {
  admissionPending,
  type ClaimAnswer,
  type ClaimDeps,
  claimLocalWorkspaces,
  type OrganizationAnswer,
} from "./claimOnSignIn";

function harness(input: {
  ids: readonly string[];
  organization?: OrganizationAnswer;
  answers?: Record<string, ClaimAnswer>;
  onClaim?: (input: {
    workspaceId: string;
    organizationId: string;
  }) => ClaimAnswer | Promise<ClaimAnswer>;
}) {
  const organization = vi.fn(
    async (): Promise<OrganizationAnswer> =>
      input.organization ?? { ok: true, organizationId: "org-1" },
  );
  const claimed: { workspaceId: string; organizationId: string }[] = [];
  const claim = vi.fn(async (call: { workspaceId: string; organizationId: string }) => {
    claimed.push(call);
    if (input.onClaim) return input.onClaim(call);
    return input.answers?.[call.workspaceId] ?? ({ ok: true, status: "claimed" } as ClaimAnswer);
  });
  const deps: ClaimDeps = { workspaceIds: () => input.ids, organization, claim };
  return { deps, organization, claim, claimed };
}

describe("claim on sign-in", () => {
  it("claims every workspace this device already holds, changing no id", async () => {
    const run = harness({ ids: ["ws-a", "ws-b"] });
    const report = await claimLocalWorkspaces(run.deps);

    expect(report.claimed).toEqual(["ws-a", "ws-b"]);
    expect(report.stopped).toBe("none");
    // The id sent is the id the URL already names: nothing is renamed or reissued.
    expect(run.claimed).toEqual([
      { workspaceId: "ws-a", organizationId: "org-1" },
      { workspaceId: "ws-b", organizationId: "org-1" },
    ]);
    expect(admissionPending(report)).toBe(false);
  });

  it("does nothing at all — not even an organization — when the device holds nothing", async () => {
    const run = harness({ ids: [] });
    const report = await claimLocalWorkspaces(run.deps);
    expect(run.organization).not.toHaveBeenCalled();
    expect(run.claim).not.toHaveBeenCalled();
    expect(report.attempted).toBe(0);
  });

  it("treats the recents list as a set, not a sequence", async () => {
    const run = harness({ ids: ["ws-a", " ws-a ", "", "ws-b"] });
    const report = await claimLocalWorkspaces(run.deps);
    expect(report.claimed).toEqual(["ws-a", "ws-b"]);
    expect(run.claim).toHaveBeenCalledTimes(2);
  });

  it("reports an unchanged claim as unchanged, because a second claim is a no-op", async () => {
    const run = harness({
      ids: ["ws-a"],
      answers: { "ws-a": { ok: true, status: "unchanged" } },
    });
    const report = await claimLocalWorkspaces(run.deps);
    expect(report.unchanged).toEqual(["ws-a"]);
    expect(report.claimed).toEqual([]);
  });

  it("keeps going when one workspace belongs to another organization", async () => {
    // A share link can make a workspace known here without this account owning it.
    const run = harness({
      ids: ["ws-a", "ws-b"],
      answers: { "ws-a": { ok: false, code: "workspace-already-claimed" } },
    });
    const report = await claimLocalWorkspaces(run.deps);
    expect(report.refused).toEqual([{ workspaceId: "ws-a", code: "workspace-already-claimed" }]);
    expect(report.claimed).toEqual(["ws-b"]);
    expect(report.stopped).toBe("none");
  });

  it("stops at the admission gate and does not touch the rest", async () => {
    const run = harness({
      ids: ["ws-a", "ws-b"],
      onClaim: () => ({ ok: false, code: "admission-pending" }),
    });
    const report = await claimLocalWorkspaces(run.deps);
    expect(report.stopped).toBe("admission");
    expect(admissionPending(report)).toBe(true);
    expect(run.claim).toHaveBeenCalledTimes(1);
  });

  it("stops when the licence has no room rather than asking again", async () => {
    const run = harness({
      ids: ["ws-a", "ws-b", "ws-c"],
      onClaim: () => ({ ok: false, code: "seat-refused" }),
    });
    const report = await claimLocalWorkspaces(run.deps);
    expect(report.stopped).toBe("ceiling");
    expect(run.claim).toHaveBeenCalledTimes(1);
  });

  it("stops when the account service is not there", async () => {
    for (const code of ["auth-not-configured", "unreachable"]) {
      const run = harness({ ids: ["ws-a", "ws-b"], onClaim: () => ({ ok: false, code }) });
      const report = await claimLocalWorkspaces(run.deps);
      expect(report.stopped).toBe("unreachable");
      expect(run.claim).toHaveBeenCalledTimes(1);
    }
  });

  it("claims nothing when the account cannot get an organization", async () => {
    const run = harness({ ids: ["ws-a"], organization: { ok: false, code: "forbidden" } });
    const report = await claimLocalWorkspaces(run.deps);
    expect(report.stopped).toBe("organization");
    expect(run.claim).not.toHaveBeenCalled();
  });

  it("surfaces a held account when the organization itself is refused", async () => {
    const run = harness({ ids: ["ws-a"], organization: { ok: false, code: "admission-pending" } });
    const report = await claimLocalWorkspaces(run.deps);
    expect(report.stopped).toBe("admission");
    expect(admissionPending(report)).toBe(true);
  });

  it("survives a throw from the transport, because a claim must never break local work", async () => {
    const organization = vi.fn(async (): Promise<OrganizationAnswer> => {
      throw new Error("no network");
    });
    const report = await claimLocalWorkspaces({
      workspaceIds: () => ["ws-a"],
      organization,
      claim: async () => ({ ok: true, status: "claimed" }),
    });
    expect(report.stopped).toBe("organization");
    expect(report.claimed).toEqual([]);
  });

  it("stops the run when a claim itself throws mid-way", async () => {
    const report = await claimLocalWorkspaces({
      workspaceIds: () => ["ws-a", "ws-b"],
      organization: async () => ({ ok: true, organizationId: "org-1" }),
      claim: async ({ workspaceId }) => {
        if (workspaceId === "ws-b") throw new Error("socket hang up");
        return { ok: true, status: "claimed" };
      },
    });
    expect(report.claimed).toEqual(["ws-a"]);
    expect(report.stopped).toBe("unreachable");
  });
});
