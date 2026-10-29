import { useAccountStore } from "../auth/useAccountStore";
import { repositoryUrl } from "../repository";

/**
 * The parts of the launcher that point somewhere else: the source, and an account.
 *
 * They live here rather than in the launcher because neither knows anything about workspaces:
 * one is a link, the other opens a dialog the account store owns. Keeping them out of the screen
 * that lists recent workspaces also keeps that file inside its length limit, which is the same
 * reason the row controls sit beside it.
 */

/** The GitHub mark, at the size a 13px label wants. Decorative: the label says the rest. */
function GitHubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** The source, beside the two doors that make a workspace. */
export function RepositoryButton() {
  return (
    <a
      data-testid="launcher-github"
      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--hairline)] px-4 py-2 text-[13px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10"
      href={repositoryUrl()}
      target="_blank"
      rel="noreferrer"
    >
      <GitHubMark />
      GitHub
    </a>
  );
}

/** The copyright line, which is also the quietest way to the source. */
export function RepositoryFooter() {
  return (
    <footer className="border-t border-[var(--hairline)] px-8 py-3 text-[11px] text-[var(--ink-muted)]">
      <a
        data-testid="launcher-repository"
        className="underline-offset-2 hover:text-[var(--ink)] hover:underline"
        href={repositoryUrl()}
        target="_blank"
        rel="noreferrer"
      >
        Open source under MIT, {new Date().getFullYear()} Suite
      </a>
    </footer>
  );
}

/**
 * The account door, in the body rather than in the header.
 *
 * A visitor with no account and workspaces saved here is the one reader for whom the account
 * surfaces answer a question they have already asked: the list above says these live here, and an
 * account is the way out of that. The header carries the same pair, and this is the copy placed
 * where somebody who has just read their own list will look.
 */
export function SavedLocallyPrompt() {
  return (
    <div
      data-testid="launcher-account-prompt"
      className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2.5"
    >
      <div className="min-w-0 flex-1 text-[12px] leading-5">
        <p className="font-medium">Saved in this browser only.</p>
        <p className="text-[var(--ink-muted)]">
          An account keeps them, and a plan syncs them to your other devices.
        </p>
      </div>
      <button
        type="button"
        data-testid="launcher-account-prompt-create"
        className="shrink-0 rounded-lg bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)]"
        onClick={() => useAccountStore.getState().openSignIn("sign-up")}
      >
        Create account
      </button>
      <button
        type="button"
        data-testid="launcher-account-prompt-signin"
        className="shrink-0 rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => useAccountStore.getState().openSignIn("sign-in")}
      >
        Sign in
      </button>
    </div>
  );
}
