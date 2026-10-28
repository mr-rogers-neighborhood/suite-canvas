/**
 * `@suite/settings` — the registry of runtime values, and the rules for reading them.
 *
 * The control plane stores them, the panel edits them and a feature reads them per request.
 * Nothing here knows about HTTP, a database or the panel: `resolveSetting` is a pure
 * function of rows, environment and a key, which is what makes the precedence testable
 * without a server.
 *
 * The one boundary worth stating: a value the process needs before it can read a row stays
 * in `.env`, and `BOOTSTRAP_VARIABLES` is that list. Everything else can live in the panel.
 */

export { envWithSettings, RESTART_KEYS } from "./overlay.js";
export {
  BOOTSTRAP_VARIABLES,
  SETTINGS,
  SETTINGS_BY_KEY,
  type SettingDefinition,
  type SettingKind,
  settingDefinition,
} from "./registry.js";
export {
  GLOBAL_SCOPE,
  orgScope,
  parseSetting,
  type ResolvedSetting,
  resolveAll,
  resolveSetting,
  type SettingSource,
  type StoredSetting,
} from "./resolve.js";
export {
  decryptSetting,
  encryptSetting,
  isEncryptedSetting,
  SECRET_MASK,
} from "./secrets.js";
