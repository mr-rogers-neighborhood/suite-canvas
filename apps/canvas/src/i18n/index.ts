import { type ErrorCode, errorCodes, isErrorCode } from "./codes";
import { english } from "./messages.en";

/**
 * One catalogue, one locale, one lookup.
 *
 * The scaffolding is deliberately this small: codes are stable and typed
 * (`codes.ts`), the words live in a catalogue (`messages.en.ts`), and a surface
 * asks for a sentence by code. A second locale is a new catalogue file and an
 * entry in `catalogues`; nothing else in the app changes, because nothing in the
 * app holds a sentence.
 *
 * There is no plural machinery and no date or number formatting yet. Both are
 * decisions with real cost, and inventing a format nobody uses would be a guess.
 */
export const locales = ["en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Values a message may interpolate. Strings are not translated; they are names. */
export type MessageParams = Readonly<Record<string, string | number>>;

const catalogues: Record<Locale, Record<ErrorCode, string>> = { en: english };

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fills `{name}` placeholders. A placeholder with no value stays as written: the
 * gap is then visible in the interface and greppable in a report, which is more
 * useful than a silently empty phrase.
 */
export function formatMessage(template: string, params: MessageParams = {}): string {
  return template.replace(PLACEHOLDER, (whole, key: string) => {
    const value = params[key];
    return value === undefined ? whole : String(value);
  });
}

/**
 * The sentence for a code, in one locale.
 *
 * An unknown code is returned as itself. A reader sees something short and
 * greppable rather than a blank panel, and the string still matches the code the
 * report names.
 */
export function messageFor(
  code: string,
  params: MessageParams = {},
  locale: Locale = defaultLocale,
): string {
  if (!isErrorCode(code)) return code;
  return formatMessage(catalogues[locale][code], params);
}

export { type ErrorCode, errorCodes, isErrorCode };
