/**
 * The operator token this tab holds, read without importing the admin client.
 *
 * The token lives in `sessionStorage` under the key the operator panel writes
 * (`storedAdminToken` in `../admin/api.ts`). That module is the whole admin API,
 * and importing it here would drag it into the canvas bundle's main chunk just to
 * answer "is somebody signed in as an operator?". So the key is duplicated,
 * deliberately, and this is the only file that does it. `sessionStorage` is per
 * tab: an operator who signed in elsewhere has to do it again in the tab that
 * holds the canvas.
 */
export const OPERATOR_TOKEN_KEY = "suite.admin.token";

/** The token, or null when this tab holds none (or storage is unavailable). */
export function operatorToken(): string | null {
  try {
    const value = window.sessionStorage.getItem(OPERATOR_TOKEN_KEY);
    return value !== null && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}
