# ADR-0056: Card Settings owns entity defaults

- Status: proposed
- Date: 2026-10-25
- Shipped: nothing. The type editor (`panels/TypeSettingsDialog.tsx`) exists and shows every field
  as if the user owned it.
- Remaining: the `runtime` marker on field definitions, the read-only runtime rows, the Card Settings
  surface, and the placement numbers (gap, columns, ring radius, padding).
- Full text: [archive](../../../../history/decisions/0056-card-settings-owns-defaults.md)

## Decision

An authored field is one the user created and may edit; a runtime-owned field is one the app reads by
contract, marked `runtime` on its definition. The type editor shows runtime rows read-only and links to
Card Settings, which owns defaults for new cards, sketches and portals — stored on the workspace
document, never in localStorage.

## Consequences

- Ownership is stated in the data, not inferred from a field name, so a type named "Sketch" is just a
  type and cannot become a second sketch renderer.
- Per-card values still win; Card Settings only decides what the next card looks like.
- Styling rules stay separate from defaults, which keeps a second theme system from growing.
- Deleting a runtime row is refused with a reason; hiding a field is the supported way to reduce noise.
