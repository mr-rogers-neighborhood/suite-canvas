const STORAGE_KEY = "suite.identity";

/** What an unidentified person is called, in the bar and on their cursor. */
export const ANONYMOUS_NAME = "Anonymous";

const COLORS = [
  "#f97316",
  "#e11d48",
  "#7c3aed",
  "#2563eb",
  "#0891b2",
  "#16a34a",
  "#ca8a04",
  "#db2777",
] as const;

export interface Identity {
  name: string;
  color: string;
}

function randomItem<T>(items: readonly T[]): T {
  const item = items[Math.floor(Math.random() * items.length)];
  if (item === undefined) {
    throw new Error("cannot pick from an empty list");
  }
  return item;
}

function parseStored(value: string): Identity | null {
  try {
    const parsed = JSON.parse(value) as Partial<Identity>;
    if (typeof parsed.name === "string" && typeof parsed.color === "string") {
      return { name: parsed.name, color: parsed.color };
    }
  } catch {
    // fall through and generate a fresh identity
  }
  return null;
}

/**
 * A stable per-browser identity used for presence: a colour, and the word
 * "Anonymous".
 *
 * The colour is the only thing that has to be unique — it is what tells two
 * cursors apart — so the name does not pretend to be one. Generated nicknames
 * ("Nova-347") read as a person you should recognise, took the width of a tab,
 * and told the reader nothing a dot did not. A signed-in peer still arrives with
 * their account name; this is the fallback, and it says so.
 */
export function getOrCreateIdentity(): Identity {
  if (typeof localStorage === "undefined") {
    return { name: ANONYMOUS_NAME, color: "#2563eb" };
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  const parsed = stored ? parseStored(stored) : null;
  // A stored identity keeps its colour; the old generated nickname is dropped
  // rather than migrated, so every browser reads the same.
  if (parsed) return { name: ANONYMOUS_NAME, color: parsed.color };

  const identity: Identity = { name: ANONYMOUS_NAME, color: randomItem(COLORS) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}
