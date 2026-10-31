---
title: Appearance
description: "Light, dark or system, and the reader's own density, canvas and radius."
order: 70
targets:
  - kind: ui
    id: theme-toggle
---

The theme control switches between light, dark and system. System follows the device and keeps
following it, so a laptop that dims at night changes the app without anyone touching this control.

Everything past the theme lives in **Settings**, which the same menu opens:

- **Density** — compact reduces the padding inside a card body, so more cards fit on one screen.
- **Canvas** — plain hides the dot grid.
- **Card radius** — one variable, and a card's own stored radius still wins.
- **Motion** — a preference the interface honours rather than a switch that only its own animations
  read.
- **The workspace palette** — the swatches everything else chooses from. This one is document data,
  so it is shared; the rest is this device.

None of the device settings sync, by design: they change how this screen draws, never what a peer
sees.
