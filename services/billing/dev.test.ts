import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { main } from "./dev.ts";
import { licenceIdFor } from "./issue.ts";
import {
  CUSTOMER_EMAIL,
  claimsOf,
  DAY,
  NOW,
  PRICE_SOLO,
  privatePem,
  TIERS_JSON,
} from "./testing.ts";

const ENV = { SUITE_LICENCE_PRIVATE_KEY: privatePem, STRIPE_PRICE_TIERS: TIERS_JSON };

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) },
  };
}

describe("dev.ts --dry-run", () => {
  it("signs a real licence from the configured tier table and prints the email", async () => {
    const { io, out, err } = capture();
    const code = await main(
      ["--dry-run", "--email", CUSTOMER_EMAIL, "--price", PRICE_SOLO, "--days", "5"],
      ENV,
      io,
      () => NOW,
    );

    assert.equal(code, 0, err.join("\n"));
    assert.equal(out.length, 1, "stdout carries the token and nothing else");
    const token = out[0] ?? "";
    assert.deepEqual(claimsOf(token), {
      v: 1,
      id: licenceIdFor(`manual:${CUSTOMER_EMAIL}`),
      tier: "solo",
      workspaces: 3,
      documentBytes: 268_435_456,
      attachmentBytes: 1_073_741_824,
      issuedAt: NOW,
      expiresAt: NOW + 5 * DAY,
      email: CUSTOMER_EMAIL,
    });

    const printed = err.join("\n");
    assert.ok(printed.includes("dry run: issued solo licence"));
    assert.ok(printed.includes(token), "the operator must see the email they would have sent");
    assert.ok(printed.includes("Self-host it:"));
  });

  it("accepts an explicit tier instead of a configured price", async () => {
    const { io, out, err } = capture();
    const code = await main(
      ["--dry-run", "--email", CUSTOMER_EMAIL, "--tier", "studio", "--workspaces", "9"],
      { SUITE_LICENCE_PRIVATE_KEY: privatePem },
      io,
      () => NOW,
    );

    assert.equal(code, 0, err.join("\n"));
    const claims = claimsOf(out[0] ?? "");
    assert.equal(claims.tier, "studio");
    assert.equal(claims.workspaces, 9);
    assert.equal(claims.expiresAt, NOW + 30 * DAY);
  });

  it("refuses to run without --dry-run", async () => {
    const { io, err } = capture();
    const code = await main(["--email", CUSTOMER_EMAIL, "--price", PRICE_SOLO], ENV, io);
    assert.equal(code, 1);
    assert.ok(err.join("\n").includes("--dry-run"));
  });

  it("says how to make a key when none is available", async () => {
    const { io, err } = capture();
    const code = await main(
      ["--dry-run", "--email", CUSTOMER_EMAIL, "--price", PRICE_SOLO],
      { STRIPE_PRICE_TIERS: TIERS_JSON },
      io,
    );
    assert.equal(code, 1);
    assert.ok(err.join("\n").includes("licence generate-keypair"));
  });

  it("rejects an argument it does not understand", async () => {
    const { io, err } = capture();
    const code = await main(["--dry-run", "stray"], ENV, io);
    assert.equal(code, 1);
    assert.ok(err.join("\n").includes("Unexpected argument"));
  });
});
