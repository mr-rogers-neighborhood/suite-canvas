import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * The scratchpad ([docs/scratchpad.md](../docs/scratchpad.md)).
 *
 * A place the author can write between passes without sending a chat message, which is
 * the only way to say something without ending the turn the agent is working in. The
 * mechanism is deliberately a *script*: an instruction alone ("check the scratchpad")
 * is a promise, and a promise is not a guarantee. `pnpm scratchpad` prints whether the
 * file changed since it was last read, so the check is one command — and it is part of
 * `pnpm verify`, which every change runs before it is called done.
 *
 *   pnpm scratchpad           print, and mark what was printed as read
 *   pnpm scratchpad --peek    print without marking
 *   pnpm scratchpad --quiet   only speak when something is new (for `verify`)
 */
const SCRATCHPAD = "docs/scratchpad.md";
const MARKER = ".scratchpad-seen";

/**
 * The template, because the file itself is gitignored: it is the author's own queue
 * and nobody else's, and committing it would clutter the repository with notes that
 * mean nothing to a reader who was not in the conversation. The instructions still
 * point at the path, so this script has to be able to make it.
 */
const TEMPLATE = `# Scratchpad

The author's queue between passes. Write here instead of interrupting a turn: the agent reads
this file with \`pnpm scratchpad\`, which runs first in \`pnpm verify\`, so a changed note shows up in
the output of a command that always runs.

**This file is gitignored** — it is a queue, not a document. Nothing here survives on its own.

## How to write here

One bullet per thought, under **Open**. No format, no order, no cleanup needed. Put \`#PRIORITY\`
on a line to make it the next thing the agent does rather than something it triages.

## How it empties

Each item leaves **Open** and appears under **Promoted** with where it went:

| an item that is… | becomes |
| --- | --- |
| a decision with a reason | an amendment on the ADR in \`decisions/\` that owns it |
| a piece of work | a todo, or a phase in the session plan |
| a fact about what shipped | the "what implementing settled" section of that ADR |
| a question with two answers | that ADR's open questions, so it is asked once |
| noise | deleted |

---

## Open

_Nothing open._

---

## Promoted

Newest first. \`date · item → where it went\`.
`;

const quiet = process.argv.includes("--quiet");
const peek = process.argv.includes("--peek");

if (!existsSync(SCRATCHPAD)) {
  writeFileSync(SCRATCHPAD, TEMPLATE);
  if (!quiet) console.log(`[scratchpad] created ${SCRATCHPAD} from the template`);
}

const raw = readFileSync(SCRATCHPAD, "utf8");

/**
 * Open items first, because they are the only part that needs acting on.
 *
 * The file has three regions: the preamble, `## Open`, and `## Promoted`. A file without
 * those headings is printed whole, so an older scratchpad still reads.
 */
function sections(markdown) {
  const open = markdown.indexOf("## Open");
  const promoted = markdown.indexOf("## Promoted");
  if (open === -1) return { head: markdown, open: "", promoted: "" };
  const cut = promoted === -1 ? markdown.length : promoted;
  return {
    head: markdown.slice(0, open),
    open: markdown.slice(open, cut),
    promoted: promoted === -1 ? "" : markdown.slice(promoted),
  };
}

const parts = sections(raw);
const text = [parts.head, parts.open, parts.promoted].filter(Boolean).join("").trimEnd();
const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
const seen = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "";
const changed = seen !== digest;

if (!changed && quiet) process.exit(0);

// Count what is actually open: a bullet under `## Open` that is not the placeholder.
const openLines = parts.open
  .split("\n")
  .slice(1)
  .filter((line) => line.startsWith("- ") && !line.startsWith("- _")).length;
const openSummary =
  openLines === 0 ? "queue empty" : `${openLines} open item${openLines === 1 ? "" : "s"}`;

if (changed) {
  console.log(
    seen === ""
      ? `[scratchpad] never read, ${openSummary} — full content follows`
      : `[scratchpad] CHANGED since last read, ${openSummary} — read this before continuing`,
  );
} else {
  console.log(`[scratchpad] unchanged since last read, ${openSummary}`);
}

console.log("─".repeat(72));
console.log(text.trimEnd());
console.log("─".repeat(72));
console.log(
  [
    "[scratchpad] promote, do not accumulate:",
    "  a decision        -> an amendment on the ADR it belongs to (docs/decisions/)",
    "  a piece of work   -> the session todo list, or the phase in plan.md",
    "  a fact about now  -> the ADR's 'what implementing settled' section",
    "  a question        -> the ADR's open questions, so it is asked once",
    "Entries that have been promoted get struck through in the scratchpad.",
  ].join("\n"),
);

if (!peek && changed) writeFileSync(MARKER, `${digest}\n`);
