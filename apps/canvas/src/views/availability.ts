/**
 * Whether this build shows the views surfaces: the nav-row menu and the editor.
 *
 * Views are the feature the author keeps pulling on, and the surface around them is still moving —
 * the editor, the presentation and the charts all landed in one pass. So the doors stay behind a
 * development flag, worded exactly like the handbook's (`handbook/availability.ts`): one switch,
 * read where the two surfaces mount, and `import.meta.env.DEV` is a literal Vite inlines so a
 * production bundle drops the components with the branch.
 */
export const viewsEnabled: boolean = import.meta.env.DEV;
