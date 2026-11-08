# Accessibility

Suite is alpha software, and this page says where accessibility stands rather than promising
where it will be. The goal is WCAG 2.2 AA, verified by hand as well as by machine.

## What is automated today

- **Colour contrast.** Every theme preset is measured against WCAG 2.x ratios in the build
  gate: 4.5:1 for body text on every surface it can sit on, 3:1 for focus rings and for
  component boundaries, and a perceivable hairline. A preset that fails cannot be committed.
- **Theme values are measurable.** A preset may not hide behind a `color-mix()` or a gradient;
  a colour that cannot be measured cannot be checked.

## What is manual

These are checked by a person, and are not covered by the gate yet:

- Keyboard reachability of every control, and a visible focus indicator on each.
- Screen reader output for the launcher, the canvas, and the dialogs.
- Zoom to 200% without loss of content, and reflow at 320 CSS pixels.
- Motion: whether every animation honours `prefers-reduced-motion`.
- Targets: 24×24 CSS pixels minimum for pointer targets.

## Known gaps

Listed because a statement that admits nothing is not a statement:

- **Decorative hairlines are below 3:1 by design.** A divider between list rows is exempt
  under SC 1.4.11, and a line strong enough to reach 3:1 stops being a hairline. Anything
  that is a *component boundary* uses a different role that is held to 3:1.
- **Canvas's infinite board is not fully keyboard navigable.** Cards can be reached and
  moved, but spatial navigation has no complete keyboard model yet.
- **Drag-and-drop has no keyboard equivalent** in the canvas or the planner.
- **No formal audit has been run.** Everything above is the maintainers' own testing.

## Reporting a problem

Open an issue with what you were doing, what you expected, and what happened. A description
of the barrier is more useful than a suggested fix.

## Why this is not a date

The interfaces are still changing, and a checklist against a moving target is a checklist that
is wrong by the time it is read. What is written here is checked again when a surface changes.
