import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The values the canvas bakes in, and the two files that have to agree with them.
 *
 * Vite replaces `import.meta.env.VITE_*` at build time, so a deployment variable that is
 * only in the *runtime* environment never reaches the browser. That failure is invisible
 * from inside the app: the Turnstile widget simply does not render, and a deployment which
 * set `SUITE_TURNSTILE_SECRET` refuses every sign-up with a challenge the client could not
 * answer. The image is built here, so the guard is a text assertion over the two files that
 * do the plumbing rather than a test that would need Docker.
 */
const repoRoot = join(__dirname, "..", "..", "..", "..");

/** Inlined at build time, so it must be a build argument as well as an environment row. */
const BAKED_IN = [
  { vite: "VITE_SUITE_TURNSTILE_SITE_KEY", build: "SUITE_TURNSTILE_SITE_KEY" },
  { vite: "VITE_SUITE_AUTH_URL", build: "SUITE_AUTH_URL" },
  { vite: "VITE_SUITE_VERSION", build: "SUITE_VERSION" },
];

const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
const compose = readFileSync(join(repoRoot, "compose.yaml"), "utf8");

/** The `FROM deps AS build` stage, where the canvas is compiled. */
function buildStage(): string {
  const start = dockerfile.indexOf("FROM deps AS build");
  expect(start, "the build stage is the one that compiles the canvas").toBeGreaterThan(-1);
  return dockerfile.slice(start, dockerfile.indexOf("FROM base AS server-base"));
}

/** The `caddy` service block, which is the image that carries the built canvas. */
function caddyService(): string {
  const start = compose.indexOf("  caddy:");
  expect(start, "the caddy service builds the canvas").toBeGreaterThan(-1);
  const end = compose.indexOf("\nvolumes:", start);
  return compose.slice(start, end === -1 ? undefined : end);
}

describe("the values the canvas bakes in", () => {
  it.each(BAKED_IN)("passes $build into the build as $vite", ({ vite, build }) => {
    const stage = buildStage();

    // The argument exists, and the stage exports it under the name Vite reads.
    expect(stage).toMatch(new RegExp(`^ARG ${build}`, "mu"));
    expect(stage).toMatch(new RegExp(`${vite}=\\$\\{${build}\\}`, "u"));
  });

  it.each(BAKED_IN)("passes $build from compose into the image build", ({ build }) => {
    // A build argument nobody passes is the same bug with more ceremony: compose is what
    // the host actually runs.
    expect(caddyService()).toMatch(new RegExp(`${build}: \\$\\{${build}:`, "u"));
  });

  it("names every build argument in one place", () => {
    const declared = [...buildStage().matchAll(/^ARG (SUITE_[A-Z_]+)/gmu)].map((match) => match[1]);

    // Every build argument is one of the baked-in set or the crash DSN, so adding one is a
    // decision rather than an accident.
    expect(declared.sort()).toEqual(
      ["SUITE_AUTH_URL", "SUITE_CRASH_DSN", "SUITE_TURNSTILE_SITE_KEY", "SUITE_VERSION"].sort(),
    );
  });
});
