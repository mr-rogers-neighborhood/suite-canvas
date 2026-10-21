const STORAGE_KEY = "suite.tab-id";

function randomId(): `${number}` {
  return String(Math.floor(Math.random() * 2 ** 52)) as `${number}`;
}

/**
 * Stable for the lifetime of this tab, including a reload. Presence is keyed by
 * this id so a refreshed tab replaces its old presence instead of appearing as
 * a second frozen collaborator.
 */
export const TAB_ID: `${number}` =
  typeof sessionStorage === "undefined"
    ? randomId()
    : (() => {
        const existing = sessionStorage.getItem(STORAGE_KEY);
        if (existing && /^\d+$/.test(existing)) return existing as `${number}`;
        const id = randomId();
        sessionStorage.setItem(STORAGE_KEY, id);
        return id;
      })();
