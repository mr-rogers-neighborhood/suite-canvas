import { Server } from "@hocuspocus/server";

const port = Number(process.env.PORT ?? 1234);

const server = new Server({
  port,
  async onConnect() {
    // TODO(auth): validate the connection (token, document permissions) here.
    // Throwing rejects the connection; returning normally allows it.
  },
  async onListen({ port: listeningPort }) {
    console.log(`Hocuspocus server ready on ws://localhost:${listeningPort}`);
  },
});

await server.listen();
