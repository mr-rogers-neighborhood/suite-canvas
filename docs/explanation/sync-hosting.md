# Where a relay runs, and why no app needs Start

Sync separates a daemon from the interface in front of it. A relay is one process serving a workspace
to the people who share it; the screen that starts it, reports whether it is up and shows a pairing code
is a client of that process.

Syncthing is a daemon with a web page. Tailscale is a daemon with a tray icon. Actual Budget ships a sync
server you run anywhere and a client that connects to it. The pattern is not a suite invention.

## The split

- A standalone relay package, headless, with a command line. It runs in a container, on a NAS, on a
  Raspberry Pi, as a systemd unit, or as a child process of something else.
- Supervision is optional. Start may spawn and watch it, and so may an app, from a "serve this workspace
  from this computer" action. Neither is required.
- One shared module reports `running`, `asleep` or `unreachable` and produces the pairing code, so every
  host shows the same three states and the same code.
- The hosted tier runs the same process. That is why the decision belongs to the suite rather than to the
  hub.

## Why nothing depends on Start

Every app opens a file and works with no network, so every app has to work with the hub uninstalled. A
relay that only Start could start would make the hub a requirement for a feature of the app, which is the
coupling the separate files exist to avoid.

So Start's Sync section reports a state it does not own. With no relay running it says so, and the toggle
stays off, because a switch that cannot turn anything on reads as a broken feature.

## What is not built yet

The relay package, its command line and the pairing code are not in the hub's first release. What ships
is the section, its empty state, and the decision recorded in ADR-0099 so the package has an agreed shape
when it lands.
