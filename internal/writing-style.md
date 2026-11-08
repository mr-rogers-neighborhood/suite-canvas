<!-- docs-check: style-allowed -->

# Writing style

This page defines the house style for Suite documentation. `scripts/docs-check.mjs` enforces the mechanical rules. The rest is editorial judgment.

## The rule

State the fact. Delete the sentence that announces it, restates the heading, or summarizes the section the reader just finished.

When a sentence feels inflated, replace the abstraction with a specific fact: a name, a path, a number, a command, or a failure mode. If you do not know the fact, write a true general sentence and mark the gap. Do not invent detail to make prose sound concrete.

## Tone

Write like a senior engineer explaining a change in a pull request. Direct, specific, and neutral. Do not perform enthusiasm. Do not scold the reader. Do not write like an HR announcement.

## Banned openers

Cut sentences that describe the writing instead of doing it:

- "Let's dive in"
- "Here's what you need to know"
- "Let's break this down"
- "In this section, we'll"
- "Now let's look at"

The first sentence after a heading must add information. It must not repeat the heading.

## Banned cadence

Do not stage a contradiction to sound significant:

- "It's not just a cache; it's a reimagining of state."
- "Not because X, but because Y."
- "It's more than a tool. It's a platform."

State the claim directly. If the contrast matters, write two plain sentences.

Do not end a section with a summary. The reader has the section. Move to the next heading.

## Word choices

| Avoid | Use |
| --- | --- |
| delve | look at, read |
| leverage, harness | use |
| robust, seamless | describe what happens |
| tapestry, landscape | name the actual set |
| testament, pivotal | delete |
| serves as, stands as, marks a | is |
| quietly, fundamentally, deeply, arguably | delete |
| It's worth noting, Importantly, Notably, Keep in mind | delete |

## Punctuation

Use at most one em-dash in a document. Prefer a comma, a semicolon, a colon, or two sentences.

Do not use a bolded label as the first phrase of a bullet:

```md
- **Speed:** The system is fast.
```

Write a plain bullet, a sentence, or a table row. Bold is for a term the reader needs to find, not for decoration.

## Lists

A list of exactly three items is not automatically wrong, but check the third item. If it exists to complete a pattern, delete it. Two items, five items, and uneven lists are normal.

## Examples

| Inflated | Direct |
| --- | --- |
| The relay leverages a robust queue to seamlessly deliver updates. | The relay writes each update to one queue. A worker drains it every 200 ms. |
| This section covers testing. | `pnpm check` runs lint, typecheck, and the tests affected by your change. |
| The system is not just a CRDT; it is a collaboration model. | The system stores one `LoroDoc` per workspace. Peers sync that document over a WebSocket. |

The second column is not a synonym swap. It replaces a claim with a mechanism.

## Scope

These rules apply to `docs/tutorials/`, `docs/how-to/`, `docs/reference/`, `docs/explanation/`, the dashboard, and the root README, AGENTS, CONTRIBUTING, and SECURITY files. `internal/` is exempt because it records decisions and notes as they were written.
