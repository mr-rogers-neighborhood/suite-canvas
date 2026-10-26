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

const quiet = process.argv.includes("--quiet");
const peek = process.argv.includes("--peek");

if (!existsSync(SCRATCHPAD)) {
  if (!quiet) console.log(`[scratchpad] no ${SCRATCHPAD}`);
  process.exit(0);
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
