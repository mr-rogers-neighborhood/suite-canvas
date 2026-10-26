import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { BillingError } from "../errors.ts";
import { MAX_BODY_BYTES, readJsonBody, sendJson, statusOf } from "./json.ts";

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function request(body: string | Buffer | null): IncomingMessage {
  const stream = Readable.from(body === null ? [] : [Buffer.from(body)]);
  return stream as unknown as IncomingMessage;
}

function sink(): { response: ServerResponse; captured: Captured } {
  const captured: Captured = { status: 0, headers: {}, body: "" };
  const response = {
    writeHead: (status: number, headers: Record<string, string>) => {
      captured.status = status;
      captured.headers = headers;
      return response;
    },
    end: (chunk?: string) => {
      captured.body = chunk ?? "";
      return response;
    },
  };
  return { response: response as unknown as ServerResponse, captured };
}

describe("readJsonBody", () => {
  it("should parse one JSON body", async () => {
    const parsed = await readJsonBody(request('{"organizationId":"org_1"}'));

    assert.equal(parsed.isOk(), true);
    assert.deepEqual(parsed._unsafeUnwrap(), { organizationId: "org_1" });
  });

  it("should refuse an empty body", async () => {
    const parsed = await readJsonBody(request("   "));

    assert.equal(parsed.isErr() ? parsed.error.code : "ok", "invalid-request");
    assert.equal(parsed.isErr() ? parsed.error.message : "", "body is empty");
  });

  it("should refuse a body that is not JSON", async () => {
    const parsed = await readJsonBody(request("{oops"));

    assert.equal(parsed.isErr() ? parsed.error.code : "ok", "invalid-request");
    assert.equal(parsed.isErr() ? parsed.error.message : "", "body is not JSON");
  });

  it("should refuse a body over the limit", async () => {
    const parsed = await readJsonBody(request("x".repeat(MAX_BODY_BYTES + 1)));

    assert.equal(parsed.isErr() ? parsed.error.code : "ok", "invalid-request");
    assert.match(parsed.isErr() ? parsed.error.message : "", /larger than/u);
  });
});

describe("sendJson", () => {
  it("should write one uncached JSON answer", () => {
    const { response, captured } = sink();

    sendJson(response, 200, { tier: "free", limits: {} });

    assert.equal(captured.status, 200);
    assert.equal(captured.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(captured.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(captured.body), { tier: "free", limits: {} });
  });
});

describe("statusOf", () => {
  it("should blame the caller for a bad request and itself for a fault", () => {
    assert.equal(statusOf(new BillingError("invalid-request", "no")), 400);
    assert.equal(statusOf(new BillingError("not-configured", "no")), 503);
    assert.equal(statusOf(new BillingError("invalid-config", "no")), 500);
    assert.equal(statusOf(new BillingError("unexpected", "no")), 500);
  });
});
