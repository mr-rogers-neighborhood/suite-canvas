/**
 * Compatibility surface for the licence token format.
 *
 * `services/billing` deep-imports this path to sign the tokens the relay
 * verifies, so the file stays here while the implementation lives in
 * `store/licence.ts`. Internal code imports the store module directly.
 */
export * from "./store/licence.js";
