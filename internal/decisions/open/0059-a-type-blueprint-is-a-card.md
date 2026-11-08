# ADR-0059: A type blueprint is a card, and a kit is a tag

- Status: proposed
- Date: 2026-10-25
- Shipped: nothing of this record. Board templates (`board.template`) and type template cards
  (`templateCardId`) come from ADR-0040 and ADR-0038 and are different primitives.
- Remaining: the catalog board, a blueprint card that declares fields as starter content, kits as
  tags, and partial install that mints new field ids.
- Full text: [archive](../../../../history/decisions/0059-a-type-blueprint-is-a-card.md)

## Decision

No new object class and no new root map: a blueprint is an ordinary card on a catalog board, whose body
is starter content and whose `Fields` list declares the schema, and a kit is a tag that groups
blueprints. Installing a blueprint mints new field ids rather than importing the catalog's ids.

## Consequences

- The shelf of ready-made objects is authorable with primitives the workspace already has.
- Field kinds stay a closed set; a catalog cannot introduce a kind nothing renders.
- Partial install is the hard part: a single field, a type, or only the starter content are separate
  units, and each needs its own copy rule.
- Versioning a blueprint is not solved by this record.
