import { SETTINGS, type SettingDefinition, settingDefinition } from "./registry.js";

/**
 * Where a value came from.
 *
 * The panel shows this beside every field, because "why is this value not what I typed?"
 * is the question a settings screen must answer without a support ticket. `env` and
 * `default` mean nobody has saved a row, so saving one is what makes the panel win.
 */
export type SettingSource = "organization" | "global" | "env" | "default";

export interface ResolvedSetting {
  key: string;
  /** Parsed, and never a secret: a caller asking for a secret gets `undefined`. */
  value: string | number | boolean | null;
  source: SettingSource;
  /** True when the definition is a secret, so a caller knows why the value is absent. */
  secret: boolean;
}

/** One stored row, as the resolver reads it. */
export interface StoredSetting {
  scope: string;
  key: string;
  value: string;
  /** When the row was written, for a caller that has to say "restart to apply". */
  updatedAt?: number | null;
}

/** The scope string for one organization's override. */
export function orgScope(organizationId: string): string {
  return `org:${organizationId}`;
}

/** The scope string for the deployment-wide value. */
export const GLOBAL_SCOPE = "global";

/**
 * Parses a stored or environment value into the definition's type.
 *
 * A value that will not parse is `null` rather than an error: a settings table an operator
 * mistyped should not take the app down, and the panel shows the raw string beside the
 * field so the mistake is visible where it was made.
 */
export function parseSetting(
  definition: SettingDefinition,
  raw: string | undefined,
): string | number | boolean | null {
  if (raw === undefined) return null;
  switch (definition.kind) {
    case "number": {
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }
    case "boolean":
      // `1`/`true`/`yes` are on; anything else, including absent, is off.
      return /^(1|true|yes|on)$/i.test(raw.trim());
    case "enum":
      return definition.values?.includes(raw) ? raw : null;
    case "secret":
    case "string":
      return raw;
  }
}

/**
 * Resolves one key: an organization's row, then the deployment's, then the environment,
 * then the default.
 *
 * The order is the promise the panel makes. An operator's saved row beats a leftover
 * environment variable, so a deployment that once exported `STRIPE_SECRET_KEY` is not
 * frozen at that value; and the *provenance* is returned so the panel can say which level
 * answered, rather than guessing from the value.
 */
export function resolveSetting(input: {
  key: string;
  organizationId?: string | null;
  rows: readonly StoredSetting[];
  env?: Readonly<Record<string, string | undefined>>;
  /** False when the caller may not see secrets; the value is then null. */
  revealSecrets?: boolean;
}): ResolvedSetting | null {
  const definition = settingDefinition(input.key);
  if (!definition) return null;

  const find = (scope: string): string | undefined =>
    input.rows.find((row) => row.scope === scope && row.key === input.key)?.value;

  const organizationId = input.organizationId ?? null;
  const organizationRow =
    definition.overridable === true && organizationId !== null
      ? find(orgScope(organizationId))
      : undefined;
  const globalRow = find(GLOBAL_SCOPE);
  const envValue = definition.env ? input.env?.[definition.env] : undefined;

  const [source, raw]: [SettingSource, string | undefined] =
    organizationRow !== undefined
      ? ["organization", organizationRow]
      : globalRow !== undefined
        ? ["global", globalRow]
        : envValue !== undefined && envValue !== ""
          ? ["env", envValue]
          : ["default", definition.fallback];

  if (definition.kind === "secret" && input.revealSecrets !== true) {
    return { key: input.key, value: null, source, secret: true };
  }
  return { key: input.key, value: parseSetting(definition, raw), source, secret: false };
}

/** Every setting resolved, in registry order, for the panel's one read. */
export function resolveAll(input: {
  organizationId?: string | null;
  rows: readonly StoredSetting[];
  env?: Readonly<Record<string, string | undefined>>;
  revealSecrets?: boolean;
}): ResolvedSetting[] {
  return SETTINGS.flatMap((definition) => {
    const resolved = resolveSetting({ ...input, key: definition.key });
    return resolved === null ? [] : [resolved];
  });
}
