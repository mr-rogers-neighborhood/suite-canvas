/**
 * Whether this build shows the handbook.
 *
 * The handbook is the feature its author calls defining, and it is also young: the picker, the spotlight
 * and the matching rules are the parts most likely to change shape after a week of use. So it is shut in
 * every build for now, and one line turns it back on.
 *
 * The flag is read in two places, because the two halves have to agree:
 *
 *   - the shell renders the bubble only when this is true;
 *   - the board renders the floating explain panel only when it is false, so `explain` keeps an answer
 *     instead of gathering a selection and showing nothing. That fallback is why `false` is safe here: the
 *     command still works, it just answers in the older surface.
 *
 * The articles in `handbook/` are untouched and keep rendering into the docs site: they document the
 * interface, and documentation does not need the surface to be switched on.
 */
export const handbookEnabled: boolean = false;
