import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteAttachmentStore, newAttachmentId } from "../store/attachments.js";
import {
  ATTACHMENT_API_PATH,
  ATTACHMENT_ID_HEADER,
  ATTACHMENT_SECURITY_HEADERS,
  handleAttachmentRequest,
} from "./attachmentHttp.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7, 7]);

let server: Server;
let baseUrl: string;
let store: ReturnType<typeof createSqliteAttachmentStore>;

/** The owner rule the claim path uses: the registry knows who owns the workspace. */
const workspaces = {
  verify: (workspaceId: string, ownerKey: string) =>
    workspaceId === "ws-1" && ownerKey === "owner-key-1",
};

beforeEach(async () => {
  store = createSqliteAttachmentStore(":memory:", { cap: () => 64 });
  server = createServer((request, response) => {
    void handleAttachmentRequest(request, response, workspaces, { store }).then((handled) => {
      if (handled) return;
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
});

function upload(
  body: Uint8Array,
  mime: string,
  options: { ownerKey?: string | null; id?: string; workspaceId?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": mime };
  const key = options.ownerKey === undefined ? "owner-key-1" : options.ownerKey;
  if (key !== null) headers.authorization = `Bearer ${key}`;
  if (options.id) headers[ATTACHMENT_ID_HEADER] = options.id;
  return fetch(`${baseUrl}${ATTACHMENT_API_PATH}/${options.workspaceId ?? "ws-1"}`, {
    method: "POST",
    headers,
    body: body as unknown as BodyInit,
  });
}

describe("attachment upload", () => {
  it("requires the workspace owner key", async () => {
    const anonymous = await upload(PNG, "image/png", { ownerKey: null });
    expect(anonymous.status).toBe(401);

    const foreign = await upload(PNG, "image/png", { ownerKey: "someone-else" });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({
      error: "The owner key does not match this workspace.",
    });

    // A share token is not a credential this route reads at all.
    const token = await upload(PNG, "image/png", { ownerKey: "share-token-value" });
    expect(token.status).toBe(403);
    expect(store.usage("ws-1")).toBe(0);
  });

  it("stores bytes under the id the client chose", async () => {
    const id = newAttachmentId();
    const response = await upload(PNG, "image/png", { id });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id,
      mime: "image/png",
      size: PNG.byteLength,
      url: `${ATTACHMENT_API_PATH}/${id}`,
    });
    expect(store.usage("ws-1")).toBe(PNG.byteLength);
  });

  it("refuses HTML and SVG with the reason", async () => {
    const html = await upload(new TextEncoder().encode("<script>alert(1)</script>"), "text/html");
    expect(html.status).toBe(415);
    const htmlBody = (await html.json()) as { error: string; reason: string };
    expect(htmlBody.reason).toBe("attachment-mime");
    expect(htmlBody.error).toContain("HTML is not accepted");

    const svg = await upload(new TextEncoder().encode("<svg onload='alert(1)'/>"), "image/svg+xml");
    expect(svg.status).toBe(415);
    const svgBody = (await svg.json()) as { error: string };
    expect(svgBody.error).toContain("SVG is not accepted");
    expect(svgBody.error).toContain("can carry script");
  });

  it("refuses an upload that would exceed the workspace cap, with a readable reason", async () => {
    const first = await upload(PNG, "image/png");
    expect(first.status).toBe(201);

    const body = new Uint8Array(60);
    const refused = await upload(body, "image/jpeg");
    expect(refused.status).toBe(413);
    const payload = (await refused.json()) as { error: string; reason: string };
    expect(payload.reason).toBe("attachment-cap");
    expect(payload.error).toContain("SUITE_ATTACHMENT_BYTES_PER_WORKSPACE");
    expect(store.usage("ws-1")).toBe(PNG.byteLength);
  });
});

describe("attachment read", () => {
  it("serves identical bytes with the security headers", async () => {
    const id = newAttachmentId();
    await upload(PNG, "image/png", { id });

    const response = await fetch(`${baseUrl}${ATTACHMENT_API_PATH}/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(PNG.byteLength));
    for (const [name, value] of Object.entries(ATTACHMENT_SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(response.headers.get("content-disposition")).toBe(`inline; filename="${id}.png"`);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("answers 404 for an unknown id and for a malformed one", async () => {
    const unknown = await fetch(`${baseUrl}${ATTACHMENT_API_PATH}/${newAttachmentId()}`);
    expect(unknown.status).toBe(404);
    const malformed = await fetch(`${baseUrl}${ATTACHMENT_API_PATH}/not-an-id`);
    expect(malformed.status).toBe(404);
  });
});

describe("attachment delete", () => {
  it("needs the owner key of the workspace that owns the bytes", async () => {
    const id = newAttachmentId();
    await upload(PNG, "image/png", { id });

    const anonymous = await fetch(`${baseUrl}${ATTACHMENT_API_PATH}/${id}`, { method: "DELETE" });
    expect(anonymous.status).toBe(401);

    const foreign = await fetch(`${baseUrl}${ATTACHMENT_API_PATH}/${id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer someone-else" },
    });
    expect(foreign.status).toBe(403);
    expect(store.get(id)).not.toBeNull();

    const owner = await fetch(`${baseUrl}${ATTACHMENT_API_PATH}/${id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer owner-key-1" },
    });
    expect(owner.status).toBe(200);
    expect(store.get(id)).toBeNull();
  });
});

describe("attachment routing", () => {
  it("leaves every other path to the caller", async () => {
    const response = await fetch(`${baseUrl}/api/shares`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
  });

  it("refuses a method it does not serve", async () => {
    const response = await fetch(`${baseUrl}${ATTACHMENT_API_PATH}/${newAttachmentId()}`, {
      method: "PUT",
    });
    expect(response.status).toBe(405);
  });
});
