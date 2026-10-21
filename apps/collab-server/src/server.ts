import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { createDocumentStore } from "./persistence.js";

const port = Number(process.env.PORT ?? 1234);
const store = createDocumentStore(process.env.SUITE_DB ?? "suite.documents.sqlite");

const server = new Server({
  port,
  // Writes are coalesced per document, so a busy session does not hammer SQLite.
  debounce: 1000,
  maxDebounce: 5000,

  async onConnect() {
    // TODO(auth): validate the connection (token, document permissions) here.
    // Throwing rejects the connection; returning normally allows it.
  },

  async onLoadDocument({ document, documentName }) {
    const stored = store.load(documentName);
    if (stored) Y.applyUpdate(document, stored);
    return document;
  },

  async onStoreDocument({ document, documentName }) {
    store.save(documentName, Y.encodeStateAsUpdate(document));
  },

  async onListen({ port: listeningPort }) {
    console.log(`Hocuspocus server ready on ws://localhost:${listeningPort}`);
  },
});

await server.listen();

// Flush and close cleanly, so a restart never loses the last debounce window.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server
      .destroy()
      .catch(() => undefined)
      .finally(() => {
        store.close();
        process.exit(0);
      });
  });
}
