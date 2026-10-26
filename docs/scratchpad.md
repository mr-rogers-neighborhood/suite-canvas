# Scratchpad

Notes to the agent, written between passes. Append here instead of interrupting a turn:
the agent reads this file with `pnpm scratchpad`, which runs as part of `pnpm verify` and
is the first thing read at the start of a pass.

**How to use it.** Write anything, in any order — a thought, a correction, a decision, a
bug you spotted, a thing that felt wrong in the UI. No format required. If something is
urgent or blocking, put `#PRIORITY` on the line and the agent will treat it as the next
thing to do rather than something to triage later.

**What happens to it.** Nothing here is permanent. Each entry gets promoted, then struck
through, so the file stays a queue and never becomes a second source of truth:

| an entry that is… | becomes |
| --- | --- |
| a decision with a reason | an amendment on the ADR in [decisions/](./decisions/) that owns it |
| a piece of work | a todo in the session list, or a phase in `plan.md` |
| a fact about what shipped | the "what implementing settled" section of that ADR |
| a question with two answers | the ADR's open questions, so it is asked once, not twice |
| noise | deleted |

## Notes

---

Make sure to make a permanent note somewhere for the items below where appropriate, such as in the relevant ADR or documentation, or for a future discussion in a planning phase, and then mark it here as addressed or when/how it was resolved or is planned to be resolved:

- This scratchpad is a good idea! If you see this and its working, make sure to indicate so to me in the next round of review and here in the scratchpad itself, and address the items below as appropriate.
- The presence cursor has all of the elements we want to indicate, but it is indeed cluttered/ugly. Lets consider ways to simplify its appearance or make it more visually appealing. I'm also skeptical on giving the local user the full cursor indication, as it may overwhelm the interface especially with the advanced mode switchers/toggle ui we have built making it largely redundant for the local user.
- "Saved Temporarily" is still a bit confusing and instills uncertainty/hesitation for the user, as it is not clear whether the changes are permanent or if they might be lost and what that means for them. We should consider either a language change that is not just a cosmetic tweak, or a different paradigm/presentation for these temporary saves. Ideally, finding a way to get past the underlying issue so the user doesn't even have the ambiguity in the first place (if possible). Discuss with me if necessary why the browser is reporting this state and how it interacts with the user's expectations, and if its just a "my browser is being weird" situation. The less technical explanation, and more importantly the less cognitive load we can provide to the user, the better.
- Lets get the dev/testing workflows and token management established so that we can test better auth integration thoroughly in our development environment and catch any issues early before they reach production. I'm not sure if we should hide "Local Only Mode" behind a feature flag or make it more prominent for developers to easily toggle it during testing, probably the latter. This can be tied to billing, as-in to enable billing you need to also not have local only mode enabled. I don't care if someone white labels the application and support supporting it, but the development and testing experience should remain robust and straightforward.


---

