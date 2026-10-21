import { createServer } from "node:http";
import { SimpleServer } from "loro-websocket/server";
import { createDocumentStore } from "./persistence.js";

const port = Number(process.env.PORT ?? 1234);
const healthPort = Number(process.env.HEALTH_PORT ?? 1235);
const store = createDocumentStore(process.env.SUITE_DB ?? "suite.documents.sqlite");

const server = new SimpleServer({
  port,
  // Coalesce writes so an active editing session does not hammer SQLite.
  saveInterval: 2000,

  async onLoadDocument(roomId, crdtType) {
    return store.load(`${crdtType}:${roomId}`);
  },

  async onSaveDocument(roomId, crdtType, data) {
    store.save(`${crdtType}:${roomId}`, data);
  },

  async authenticate() {
    // TODO(auth): validate a token and map it to read/write per room.
    return "write";
  },
});

await server.start();
const health = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
    return;
  }
  response.writeHead(404);
  response.end();
});
health.listen(healthPort);
console.log(`Loro sync server ready on ws://localhost:${port} (health :${healthPort})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server
      .stop()
      .catch(() => undefined)
      .finally(() => {
        health.close();
        store.close();
        process.exit(0);
      });
  });
}
