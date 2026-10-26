import { type RefusalKind, refusalKind, upgradeMessage } from "./entitlement";
import { useAccountStore } from "./useAccountStore";

/**
 * One place a refusal becomes a surface.
 *
 * Every relay call that can be refused for a plan reason reports through here, so
 * there is exactly one upgrade prompt and exactly one admission notice no matter
 * which call met the wall. A refusal that is none of those — a permission, a bug,
 * a dead link — stays with the caller, because an upgrade prompt for it would be
 * a lie.
 */
export function noteRefusal(code: string | null | undefined, status?: number): RefusalKind {
  const kind = refusalKind(code, status);
  const store = useAccountStore.getState();
  if (kind === "upgrade") {
    store.noteUpgrade({
      code: (code ?? `http-${status ?? 0}`).trim(),
      message: upgradeMessage(code),
    });
  } else if (kind === "admission") {
    store.openAdmission();
  }
  return kind;
}
