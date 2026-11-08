# Accessibility

Suite is alpha software. This page says where accessibility stands, and what has actually been
checked, rather than what is intended.

The target is **WCAG 2.2 level AA**. That is 55 of the 86 success criteria in the standard. The full
breakdown is in
[`docs/accessibility/wcag-22-map.md`](https://github.com/mr-rogers-neighborhood/suite-dev/blob/main/docs/accessibility/wcag-22-map.md).

## What is verified by machine

Two checks run on every change, and a failure stops the work.

- **Colour contrast in every theme.** Each preset in `@suite/theme` is measured: 4.5:1 for body text
  on every surface it can sit on, 4.5:1 for faint text, and 3:1 for focus rings and component
  boundaries. A preset that fails cannot be merged. A colour that cannot be measured, such as a
  gradient or a `color-mix()`, is not allowed in a preset, because an unmeasurable colour cannot be
  checked.
- **axe on every start screen.** All four apps are audited against the WCAG 2.2 A and AA rule sets in
  a real window, and any violation fails the build.

The second check found a real problem the moment it was written: faint text was 3.42:1 against white
at 11px. It is fixed.

## What is verified by hand

**None of it yet.** This section will list the passes below once they have been done and written
down. Until then, do not read the machine checks above as coverage of the interface.

The protocol is written and ready to run:
[`docs/accessibility/manual-testing.md`](https://github.com/mr-rogers-neighborhood/suite-dev/blob/main/docs/accessibility/manual-testing.md).
It covers six passes per screen:

1. Keyboard only, including that focus is never hidden behind a sticky region.
2. A screen reader, with what it actually said written down.
3. Zoom to 200% and 400%, and reflow at 320 CSS pixels.
4. Reduced motion.
5. Contrast measured in the running app, not only in the palette.
6. Greyscale, to catch anything told apart by colour alone.

## Known gaps

These are real and tracked. Each has a row in the criterion map naming its success criterion.

| Area | What is missing | Level |
|---|---|---|
| Shortcuts | Canvas single-key shortcuts are not remappable or disableable (SC 2.1.4). | A |
| Board navigation | The Canvas board has no complete keyboard model for moving between cards. | AA |
| Dragging | Most drag actions have a menu or arrow-key equivalent. Three do not: resizing a section to an arbitrary size, re-pointing a section link, and bending a connector. | AA |
| Status messages | The markup is correct. Whether a screen reader hears a confirmation has not been listened to yet. | AA |

## What does not apply

Listed because a statement that admits nothing is not a statement.

- **No accounts.** There is nothing to sign in to, so the accessible-authentication criteria
  (SC 3.3.8 and 3.3.9) do not apply. Sync pairs devices with a code.
- **No audio and no video.** The time-based media criteria (SC 1.2.1 to 1.2.9) do not apply.
- **No time limits.** Nothing expires while you are working (SC 2.2.1).
- **No flashing content.** Nothing animates at a rate that could trigger a seizure (SC 2.3.1).
- **Parsing is obsolete.** SC 4.1.1 was removed in WCAG 2.2.

## Telling us about a barrier

Open an issue describing what you were doing, what you expected, and what happened. A description
of the barrier is more useful than a suggested fix, and both are welcome.

## What this runs on

Electron with Chromium, React 19, on Linux, with Orca as the screen reader used for testing.
