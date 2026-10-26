/**
 * Process entry point. The composition lives in `sync/server.ts`; this file only
 * keeps `tsx src/server.ts` (and the Docker image) pointing at the relay.
 *
 * The one piece of work here is the self-host licence (ADR-0081). `config.ts`
 * verifies `SUITE_LICENCE` and names a refusal, and the quota layer resolves its
 * caps from the environment on every read, so the caps have to be in the
 * environment before `sync/server.ts` reads the first of them. A licence that did
 * not verify leaves nothing here to apply; the relay's own boot check reports it
 * and exits.
 */
import { applyLicenceLimits, validateConfig } from "./config/config.js";

applyLicenceLimits(validateConfig(process.env).config.licence);

await import("./sync/server.js");
