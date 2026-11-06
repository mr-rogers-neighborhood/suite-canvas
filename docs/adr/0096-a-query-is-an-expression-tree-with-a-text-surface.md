# ADR-0096: a query is an expression tree with a text surface

- Status: partial (reconsidering)
- Date: 2026-11-03
- Related: [ADR-0037](./0037-a-saved-view-is-a-lens.md), [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md), [ADR-0095](./0095-the-library-is-the-view-surface.md), [`packages/graph/src/queryLanguage/`](../../packages/graph/src/queryLanguage/), [`docs/reference/query-language.md`](../../docs/reference/query-language.md)
- Shipped: `ViewExpression` in the schema; `parseQuery`, `serializeQuery`, `expressionMatches`, `materializeRelative`, `liftLegacyQuery`, `countFacets`; the `board` predicate and `contains` operator; field sorts; `FilterBar` with chips and canonical text; legacy lift on read and normalization on write.
- Remaining: autocomplete in the text editor; a field picker that writes a `field` sort.

## Decision

**One tree, two renderers.** A view's filter is a boolean tree over the existing `ViewPredicate` leaves.
The filter bar's chips and the canonical text are both projections of that tree; neither holds a copy.
`runViewQuery` evaluates the tree, and the legacy facet arrays and `groups` are lifted on read and
cleared on the first write.

The text is a deliberately small JQL-shaped language: `AND`, `OR`, `NOT`, parentheses, predicates over
type, tag, section, board, text, presence, relations and fields, comparison and set operators by field
kind, and `today()`/`now()` as symbolic dates. `ORDER BY` and `GROUP BY` are not part of it: sorting and
grouping belong to the view's presentation, and putting them in the text would give one record two editors.

A name resolves against the live schema at edit time and an id is what is stored. An unknown or ambiguous
name is an error with suggestions, never a silent drop. `parseQuery` returns a `Result` with spans, so the
editor can underline what it could not read and leave the previous query in place.

Facet counts are a projection too: the tree with that dimension's top-level `AND` terms removed, evaluated
once and histogrammed. A term nested in `OR` or `NOT` is left alone, and the bar says the count is the
current result rather than a toggle preview.

## Rejected alternatives

- **Chips only, no parser.** Cheaper, but it cannot express `A AND (B OR C)`, and the first reader who
  types a parenthesis would meet a filter that silently ignored it.
- **Text only.** JQL is fast for an expert and hostile to everyone else; the chips are the same tree for a
  reader who does not want syntax.
- **A full grammar with `ORDER BY` and functions.** The cost is an error surface, documentation and a
  migration path for every clause; sorting is already a first-class control.
- **Compiling the text to a separate evaluator.** That is the second matcher ADR-0037 and ADR-0043 exist to
  prevent; leaves are evaluated by `predicateMatches`.

## Consequences

- **`ViewPredicate` gains a `board` leaf and a `contains` operator**, both additive.
- **`viewQuerySchema` gains `expr`**, and a document can hold the tree or the legacy fields, never two live
  filters. No schema-version bump is needed.
- **A parser is now maintained.** The grammar is small on purpose; `docs/reference/query-language.md` is its
  contract, and round-trip tests are the guard.
- **Relative dates need a clock.** `runViewQuery` takes `now` in its context so tests and other callers can
  resolve `today()` deterministically.
