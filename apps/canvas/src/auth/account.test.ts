import { describe, expect, it, vi } from "vitest";
import { ensureActiveOrganization, personalOrganizationName } from "./account";
import { ORGANIZATION_NAME } from "./organization";

const ACCOUNT = {
  userId: "user-1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  admittedAt: 1,
};

describe("the name of an account's first organization", () => {
  it("uses the name the person gave at sign-up", () => {
    expect(personalOrganizationName(ACCOUNT)).toBe("Ada Lovelace");
  });

  it("falls back to the address before the @ for a method that never asked", () => {
    expect(personalOrganizationName({ ...ACCOUNT, name: null })).toBe("ada");
  });

  it("falls back to the default when the account carries neither", () => {
    expect(personalOrganizationName({ ...ACCOUNT, name: null, email: null })).toBe(
      ORGANIZATION_NAME,
    );
  });
});

describe("the organization a session acts in", () => {
  it("leaves an account that already acts in one alone", async () => {
    const ensure = vi.fn();
    const activate = vi.fn();

    const id = await ensureActiveOrganization(ACCOUNT, "org-existing", { ensure, activate });

    expect(id).toBe("org-existing");
    expect(ensure).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("makes a personal organization and selects it when the account has none", async () => {
    const ensure = vi.fn(async () => ({ ok: true as const, organizationId: "org-new" }));
    const activate = vi.fn(async () => true);

    const id = await ensureActiveOrganization(ACCOUNT, null, { ensure, activate });

    expect(ensure).toHaveBeenCalledWith("Ada Lovelace");
    expect(activate).toHaveBeenCalledWith("org-new");
    expect(id).toBe("org-new");
  });

  it("reports no organization when the account service refuses to make one", async () => {
    const ensure = vi.fn(async () => ({ ok: false as const, code: "forbidden", message: "no" }));
    const activate = vi.fn(async () => true);

    expect(await ensureActiveOrganization(ACCOUNT, null, { ensure, activate })).toBeNull();
    expect(activate).not.toHaveBeenCalled();
  });

  it("reports no organization when it cannot be made active", async () => {
    const ensure = vi.fn(async () => ({ ok: true as const, organizationId: "org-new" }));
    const activate = vi.fn(async () => false);

    expect(await ensureActiveOrganization(ACCOUNT, null, { ensure, activate })).toBeNull();
  });
});
