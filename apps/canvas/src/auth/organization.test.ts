import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which organization a page acts in.
 *
 * The relay enforces the organization in the session token, so a panel that read one
 * organization while the token named another offered a paid plan beside "your plan does
 * not cover this workspace". An account can hold several organizations, and the session's
 * active one is the only thing that decides.
 */
const readSession = vi.fn();
const list = vi.fn();
const create = vi.fn<(input: unknown) => Promise<unknown>>();
const setActive = vi.fn<(input: { organizationId: string }) => Promise<unknown>>(async () => ({
  data: {},
  error: null,
}));

vi.mock("./client", () => ({
  readSession: () => readSession(),
  authClient: {
    organization: {
      list: () => list(),
      create: (input: unknown) => create(input),
      setActive: (input: { organizationId: string }) => setActive(input),
    },
  },
}));

const { ensureOrganization } = await import("./organization");

beforeEach(() => {
  readSession.mockReset();
  list.mockReset();
  create.mockReset();
  setActive.mockReset();
  setActive.mockResolvedValue({ data: {}, error: null });
});

describe("the organization a page acts in", () => {
  it("should take the session's active organization and ask nothing else", async () => {
    readSession.mockResolvedValue({ user: { id: "u1" }, activeOrganizationId: "org-paid" });

    const answer = await ensureOrganization();

    expect(answer).toEqual({ ok: true, organizationId: "org-paid" });
    // The list may hold a comped organization and an invited one; the session decides.
    expect(list).not.toHaveBeenCalled();
    expect(setActive).not.toHaveBeenCalled();
  });

  it("should make its choice active when the session has none", async () => {
    readSession.mockResolvedValue({ user: { id: "u1" }, activeOrganizationId: null });
    list.mockResolvedValue({ data: [{ id: "org-1" }], error: null });

    const answer = await ensureOrganization();

    expect(answer).toEqual({ ok: true, organizationId: "org-1" });
    // Unset is not decided: an organization the session does not act in is one the relay
    // will refuse, so returning it without activating it is the bug this pins.
    expect(setActive).toHaveBeenCalledWith({ organizationId: "org-1" });
  });

  it("should activate an organization it creates", async () => {
    readSession.mockResolvedValue({ user: { id: "u1" }, activeOrganizationId: null });
    list.mockResolvedValue({ data: [], error: null });
    create.mockResolvedValue({ data: { id: "org-new" }, error: null });

    const answer = await ensureOrganization();

    expect(answer).toEqual({ ok: true, organizationId: "org-new" });
    expect(setActive).toHaveBeenCalledWith({ organizationId: "org-new" });
  });

  it("should refuse without trying to create anything when nobody is signed in", async () => {
    readSession.mockResolvedValue(null);

    const answer = await ensureOrganization();

    expect(answer).toMatchObject({ ok: false, code: "unauthorized" });
    expect(create).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});
