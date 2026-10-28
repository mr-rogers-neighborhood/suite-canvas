import { describe, expect, it } from "vitest";
import {
  isOperatorEmail,
  operatorEmails,
  RELAY_TOKEN_TTL,
  RELAY_TOKEN_TTL_SECONDS,
  relayClaims,
} from "./relayToken.js";

/**
 * The relay's claims (ADR-0074, ADR-0075).
 *
 * The token is the only entitlement the relay trusts, so the fields are the contract:
 * a claim that is missing here is a rule the relay cannot enforce, and a claim supplied
 * by a client would be a rule it enforces for anyone.
 */
const USER = "user-1";
const ORG = "org-agency";

describe("the relay claim payload", () => {
  it("carries sub, org, role, tier and limits, read server-side", async () => {
    const claims = await relayClaims({
      email: "person@example.com",
      operators: [],
      userId: USER,
      activeOrganizationId: ORG,
      roleIn: async () => "admin",
      entitlements: {
        forOrganization: async () => ({
          tier: "team",
          limits: { workspaces: 10, documentBytes: 1024 },
        }),
      },
    });

    expect(claims).toEqual({
      sub: USER,
      org: ORG,
      role: "admin",
      tier: "team",
      limits: { workspaces: 10, documentBytes: 1024 },
      operator: false,
    });
  });

  it("mints a token for a session with no organization, and refuses nothing", async () => {
    // A session with no tenant still needs a token: it reads its own settings and
    // claims a workspace, and the relay refuses it at the seat check instead.
    const claims = await relayClaims({
      email: "person@example.com",
      operators: [],
      userId: USER,
      activeOrganizationId: null,
      roleIn: async () => {
        throw new Error("a session with no organization has no member row to read");
      },
      entitlements: {
        forOrganization: async () => {
          throw new Error("a session with no organization asks no subscription row");
        },
      },
    });

    expect(claims).toEqual({
      sub: USER,
      org: null,
      role: null,
      tier: "free",
      limits: {},
      operator: false,
    });
  });

  it("takes the role from the member row, so a removed member mints no claim", async () => {
    const claims = await relayClaims({
      email: "person@example.com",
      operators: [],
      userId: USER,
      activeOrganizationId: ORG,
      roleIn: async () => null,
      entitlements: { forOrganization: async () => ({ tier: "team", limits: {} }) },
    });

    expect(claims.role).toBeNull();
    expect(claims.tier).toBe("team");
  });

  it("marks an operator by the deployment's list, never by an organization role", async () => {
    // The distinction that matters: an organization owner is not an operator of the
    // deployment, and an operator needs no organization at all. Both are minted from
    // server-side reads, so neither can be claimed by a client.
    const organizationOwner = await relayClaims({
      email: "owner@agency.example",
      operators: ["operator@suite.run"],
      userId: USER,
      activeOrganizationId: ORG,
      roleIn: async () => "owner",
      entitlements: { forOrganization: async () => ({ tier: "team", limits: {} }) },
    });
    const named = await relayClaims({
      email: "Operator@Suite.Run",
      operators: operatorEmails("operator@suite.run, second@suite.run"),
      userId: USER,
      activeOrganizationId: null,
      roleIn: async () => null,
      entitlements: { forOrganization: async () => ({ tier: "free", limits: {} }) },
    });

    expect(organizationOwner.role).toBe("owner");
    expect(organizationOwner.operator).toBe(false);
    // The list is matched case-insensitively, because an address is.
    expect(named.operator).toBe(true);
  });

  it("treats an empty operator list as this deployment having no operators", () => {
    expect(operatorEmails(undefined)).toEqual([]);
    expect(operatorEmails("  ,  ")).toEqual([]);
    expect(isOperatorEmail("anyone@example.com", [])).toBe(false);
  });

  it("publishes a five-minute TTL, because the TTL is the revocation window", () => {
    expect(RELAY_TOKEN_TTL_SECONDS).toBe(300);
    expect(RELAY_TOKEN_TTL).toBe("5m");
  });
});
