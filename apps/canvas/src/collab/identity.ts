const STORAGE_KEY = "suite.identity";

const NAMES = [
  "Nova",
  "Atlas",
  "Quill",
  "Orion",
  "Vega",
  "Lyra",
  "Indigo",
  "Marlowe",
  "Sage",
  "Cedar",
] as const;

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
 * A stable per-browser identity used for presence. No auth yet — it is an
 * ephemeral name + color that we persist so the same browser keeps its identity.
 */
export function getOrCreateIdentity(): Identity {
  if (typeof localStorage === "undefined") {
    return { name: "Anonymous", color: "#2563eb" };
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  const parsed = stored ? parseStored(stored) : null;
  if (parsed) return parsed;

  const identity: Identity = {
    name: `${randomItem(NAMES)}-${Math.floor(Math.random() * 900) + 100}`,
    color: randomItem(COLORS),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}
