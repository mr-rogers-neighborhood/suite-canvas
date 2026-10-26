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

Notes to the agent, written between passes. Append here instead of interrupting a turn:
the agent reads this file with \`pnpm scratchpad\`, which runs as part of \`pnpm verify\` and
is the first thing read at the start of a pass.

**This file is gitignored.** It is a queue, not a document: nothing here is permanent,
and it never becomes a second source of truth. Each entry gets promoted, then struck
through:

| an entry that is… | becomes |
| --- | --- |
| a decision with a reason | an amendment on the ADR in \`docs/decisions/\` that owns it |
| a piece of work | a todo in the session list, or a phase in \`plan.md\` |
| a fact about what shipped | the "what implementing settled" section of that ADR |
| a question with two answers | the ADR's open questions, so it is asked once, not twice |
| noise | deleted |

If something is urgent or blocking, put \`#PRIORITY\` on the line and the agent will take
it as the next thing to do rather than something to triage later.

## Notes

<!-- write below this line; newest at the bottom is fine -->
`;

const quiet = process.argv.includes("--quiet");
const peek = process.argv.includes("--peek");

if (!existsSync(SCRATCHPAD)) {
  writeFileSync(SCRATCHPAD, TEMPLATE);
  if (!quiet) console.log(`[scratchpad] created ${SCRATCHPAD} from the template`);
}

const text = readFileSync(SCRATCHPAD, "utf8");
const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
const seen = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "";
const changed = seen !== digest;

if (!changed && quiet) process.exit(0);

if (changed) {
  const lines = text.trimEnd().split("\n").length;
  console.log(
    seen === ""
      ? `[scratchpad] never read (${lines} lines) — full content follows`
      : `[scratchpad] CHANGED since last read (${lines} lines) — read this before continuing`,
  );
} else {
  console.log("[scratchpad] unchanged since last read");
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
