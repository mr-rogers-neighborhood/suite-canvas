import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  defaultLimits,
  LIMIT_ENV,
  LIMIT_KEYS,
  type LimitKey,
  type LimitOverrides,
  limitsProblem,
  resolveLimits,
} from "./limits.js";

const numericArb = fc.oneof(
  fc.integer({ min: 0, max: 2 ** 32 }),
  fc.constant(Number.POSITIVE_INFINITY),
);

/** Every env value this generator makes is one `parseLimitText` accepts. */
const envValueArb = fc.oneof(
  fc.integer({ min: 0, max: 2 ** 32 }).map((value) => String(value)),
  fc.constant("unlimited"),
);

const envArb = fc
  .tuple(fc.boolean(), fc.dictionary(fc.constantFrom(...LIMIT_KEYS), envValueArb))
  .map(([hosted, entries]) => {
    const env: Record<string, string | undefined> = {};
    if (hosted) env.SUITE_HOSTED = "1";
    for (const [key, value] of Object.entries(entries)) env[LIMIT_ENV[key as LimitKey]] = value;
    return { hosted, env };
  });

const overridesArb: fc.Arbitrary<LimitOverrides> = fc
  .dictionary(fc.constantFrom(...LIMIT_KEYS), numericArb)
  .map((entries) => entries as LimitOverrides);

function expectedEnvValue(raw: string): number {
  return raw.trim().toLowerCase() === "unlimited" ? Number.POSITIVE_INFINITY : Number(raw.trim());
}

describe("resolveLimits properties", () => {
  it("lets env beat the default and an override beat env, and never reports a problem", () => {
    fc.assert(
      fc.property(envArb, overridesArb, ({ hosted, env }, overrides) => {
        const resolved = resolveLimits(env, overrides);
        const defaults = defaultLimits(hosted);

        for (const key of LIMIT_KEYS) {
          const raw = env[LIMIT_ENV[key]];
          const override = overrides[key];
          if (override !== undefined) {
            expect(resolved.sources[key], `${key} override`).toBe("override");
            expect(resolved.limits[key], `${key} override`).toBe(override);
            continue;
          }
          if (raw !== undefined && raw.trim().length > 0) {
            expect(resolved.sources[key], `${key} env`).toBe("env");
            expect(resolved.limits[key], `${key} env`).toBe(expectedEnvValue(raw));
            continue;
          }
          expect(resolved.sources[key], `${key} default`).toBe("default");
          expect(resolved.limits[key], `${key} default`).toBe(defaults[key]);
        }

        // Every generated value is syntactically valid, so resolution has
        // nothing to report even when the resulting watermarks contradict.
        expect(resolved.problems).toEqual([]);
      }),
      { numRuns: 100, verbose: true },
    );
  });

  it("reports no problem for a monotonic configuration", () => {
    const pairArb = fc
      .record({
        soft: fc.integer({ min: 0, max: 2 ** 32 }),
        slack: fc.integer({ min: 0, max: 2 ** 31 }),
      })
      .map(({ soft, slack }) => ({ soft, hard: soft + slack }));

    const monotonicEnvArb = fc
      .tuple(fc.boolean(), fc.option(pairArb, { nil: null }))
      .map(([hosted, pair]) => {
        const env: Record<string, string | undefined> = {};
        if (hosted) env.SUITE_HOSTED = "1";
        if (pair) {
          env.SUITE_DISK_SOFT_BYTES = String(pair.soft);
          env.SUITE_DISK_HARD_BYTES = String(pair.hard);
        }
        return env;
      });

    const monotonicOverridesArb: fc.Arbitrary<LimitOverrides> = fc
      .option(pairArb, { nil: null })
      .map((pair) => (pair ? { diskSoftBytes: pair.soft, diskHardBytes: pair.hard } : {}));

    fc.assert(
      fc.property(monotonicEnvArb, monotonicOverridesArb, (env, overrides) => {
        const resolved = resolveLimits(env, overrides);

        expect(resolved.problems).toEqual([]);
        // Env and overrides always carry the two watermarks as a monotone pair,
        // so whichever layer wins the effective configuration stays monotone.
        expect(resolved.limits.diskSoftBytes).toBeLessThanOrEqual(resolved.limits.diskHardBytes);
        expect(limitsProblem(resolved.limits)).toBeNull();
      }),
      { numRuns: 80, verbose: true },
    );
  });
});
