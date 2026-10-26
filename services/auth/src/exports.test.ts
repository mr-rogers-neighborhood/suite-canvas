import { claimWorkspace, memoryControlPlane, resolvePrincipal } from "@suite/auth";
import { principalPrecedence } from "@suite/auth/principals";
import { memoryControlPlane as fromRepository } from "@suite/auth/repository";
import { checkSeat, seatLicence } from "@suite/auth/seats";
import { describe, expect, it } from "vitest";

/**
 * The package's export map, pinned.
 *
 * `apps/collab-server` imports this package through `@suite/auth`, `@suite/auth/seats`,
 * `@suite/auth/principals` and `@suite/auth/repository` — not through file paths — so a
 * folder move is only safe if those specifiers keep resolving. This test is that
 * contract: it fails the moment an entry in `package.json#exports` points at a file that
 * moved or vanished (the previous `./repository` entry pointed at a `src/repository.ts`
 * that never existed).
 */
describe("the package's public specifiers", () => {
  it("answers the root surface", () => {
    expect(typeof claimWorkspace).toBe("function");
    expect(typeof resolvePrincipal).toBe("function");
    expect(typeof memoryControlPlane).toBe("function");
  });

  it("answers ./seats with the relay's seat check", () => {
    expect(typeof checkSeat).toBe("function");
    expect(typeof seatLicence).toBe("function");
  });

  it("answers ./principals with the precedence the relay documents", () => {
    expect(principalPrecedence).toEqual(["account", "owner", "share"]);
  });

  it("answers ./repository with the store's two implementations", () => {
    expect(fromRepository).toBe(memoryControlPlane);
  });
});
