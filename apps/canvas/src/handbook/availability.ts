/**
 * Whether this build shows the handbook.
 *
 * The handbook is the feature its author calls defining, and it is also young: the picker, the
 * spotlight and the matching rules are the parts most likely to change shape after a week of use.
 * So it ships as a development-only door for now, the same way the saved-views bar does.
 *
 * One flag, read in two places, because the two halves have to agree:
 *
 *   - the shell renders the bubble only when this is true;
 *   - the board renders the floating explain panel only when it is false, so `explain` keeps an
 *     answer in a production build instead of gathering a selection and showing nothing.
 *
 * `import.meta.env.DEV` is a literal Vite inlines, so a production bundle drops both branches and
 * the components with them. Removing the flag is the whole change when the feature is ready, and
 * `docs/reference/ui.md` says so.
 */
export const handbookEnabled: boolean = import.meta.env.DEV;
