import { SETTINGS, type SettingDefinition } from "./registry.js";
import { resolveSetting, type StoredSetting } from "./resolve.js";

/**
 * An environment record with the panel's values laid over it.
 *
 * Some of this codebase reads a value once, at boot, and cannot be re-wired on every
 * request: the Stripe plugin is constructed with its key, and the mail transport is built
 * from the SMTP settings. Rather than teach each of those a second source, the boot
 * composes one environment: the process's own, with every panel-managed key replaced by its
 * resolved value. A feature keeps reading `env.STRIPE_SECRET_KEY` and gets whatever the
 * panel says, which is the property that makes "change it without a redeploy" true for the
 * values that *can* be re-read per request and honest for the ones that apply on restart.
 *
 * A value resolved to the built-in default with no row and no environment variable is left
 * alone: writing `""` over an unset variable would make `billingConfigured` read a key that
 * is not there as present.
 */
export function envWithSettings(input: {
  env: Readonly<Record<string, string | undefined>>;
  rows: readonly StoredSetting[];
  organizationId?: string | null;
}): Record<string, string | undefined> {
  const overlay: Record<string, string | undefined> = { ...input.env };
  for (const definition of SETTINGS) {
    const variable = definition.env;
    if (!variable) continue;
    const resolved = resolveSetting({
      key: definition.key,
      rows: input.rows,
      env: input.env,
      ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
      // The overlay is *for* the process that will use the value, so a secret is revealed
      // here and nowhere else. This is the one place a decrypted value may be copied.
      revealSecrets: true,
    });
    if (resolved === null || resolved.value === null) continue;
    if (resolved.source === "default" && (input.env[variable] ?? "") === "") continue;
    // Booleans travel as `1`/`0`: every reader in this codebase tests for "on", and a
    // written `true` would be a second spelling each of them has to know.
    overlay[variable] =
      definition.kind === "boolean"
        ? resolved.value === true
          ? "1"
          : "0"
        : String(resolved.value);
  }
  return overlay;
}

/** The keys whose value only takes effect when the process that reads it restarts. */
export const RESTART_KEYS: readonly string[] = SETTINGS.filter(
  (definition: SettingDefinition) => definition.group === "billing" || definition.group === "mail",
).map((definition) => definition.key);
