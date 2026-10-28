import { useEffect, useState } from "react";
import { readWornRole, type WornRoleState } from "../session/roleOverride";

/**
 * Says when this account is wearing a role it does not have.
 *
 * The override changes what the canvas lets you do, and a capability that changed without a
 * word is how somebody reports a bug that does not exist. The strip is the word: which role
 * is on, what your own role is, and that it lasts until it is cleared. Nothing renders for
 * an account with no override, which is every account but an operator's.
 */
export function WornRoleStrip() {
  const [state, setState] = useState<WornRoleState | null>(null);

  useEffect(() => {
    // A standalone build has no account service, so there is no role to wear: the literal
    // keeps the reader out of the bundle rather than fetching something that cannot answer.
    if (import.meta.env.VITE_SUITE_MODE === "standalone") return;
    let live = true;
    readWornRole()
      .then((read) => {
        if (live) setState(read.role === null ? null : read);
      })
      .catch(() => {
        if (live) setState(null);
      });
    return () => {
      live = false;
    };
  }, []);

  if (state?.role == null) return null;

  return (
    <div
      role="status"
      data-testid="worn-role-strip"
      className="flex items-center justify-center gap-2 border-b border-[var(--hairline)] bg-amber-50 px-3 py-1 text-[11px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
    >
      <span>
        Wearing the <strong>{state.role}</strong> role
        {state.realRole === null ? null : <> (your own is {state.realRole})</>}. The canvas follows
        it; billing still asks your real membership.
      </span>
      <a
        className="underline underline-offset-2"
        href="/admin.html"
        data-testid="worn-role-strip-clear"
      >
        Change it in the operator panel
      </a>
    </div>
  );
}
