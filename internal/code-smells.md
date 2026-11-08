# Code smell rubric

Read this before flagging anything. The point is to change code when the change removes a future bug or a future argument, not to relitigate style.

## Severity

| Level | Test |
| --- | --- |
| Blocker | Corrupts data, leaks another workspace, or loses work. Fix before any release. |
| High | Produces a wrong result under normal load or makes a class of bug likely. Fix in the current pass. |
| Medium | Slows work, hides intent, or duplicates a rule. Fix when the owning file is already open. |
| Low | Cosmetic or speculative. Record it, do not fix it. |

A finding without a concrete failure mode is Low. "This could be cleaner" is not a finding.

## Detection contract

Every finding states:

- `term`: the rubric name.
- `path:line`: the smallest range that shows the problem.
- `why`: the failure it causes, in one sentence.
- `smallest fix`: the edit that removes the failure, not a rewrite.
- `invariant`: the rule or decision it violates.

## Data and document

| Term | Failure | Smallest fix |
| --- | --- | --- |
| Whole-record write | Two peers edit different fields, the later write drops the first. | Write the leaf field, or use a `LoroMap` per record. |
| Missing field granularity | One text field forces a whole object replace. | Split into fields or a `LoroText` per editable unit. |
| Read creates shared state | Opening a view mutates the document for every peer. | Create on first write, not on read. |
| Undo scope bleed | Undo in one surface reverts another surface's edit. | Scope the `UndoManager` to the origin or transaction. |
| Stored derivation | A projection is written back, then drifts from its source. | Recompute at read time or mark the store rebuildable. |
| Non-rebuildable index | The index cannot be recreated from the document. | Make the index a pure function of document state. |
| Tombstone leak | Deleted records stay reachable through a query or count. | Filter at the query boundary and delete the index entry. |
| Timestamp ordering | Wall-clock order disagrees between clients. | Use the CRDT counter or a logical clock for ordering. |
| Unbounded update | One write rewrites an ever-growing array. | Bound the collection or write per item. |

## Boundaries and errors

| Term | Failure | Smallest fix |
| --- | --- | --- |
| Stringly error | Callers match on message text. | Return a typed error or `Result`. |
| Response-envelope drift | One route returns `{ data }`, another returns the payload. | One envelope helper at the HTTP edge. |
| Permissive CORS | Any origin can call an authenticated route. | Allow the configured origin list only. |
| God token | One token grants every workspace and every action. | Scope tokens to workspace and capability. |
| Capability confusion | A read share can write because the check only asks "shared?". | Check the capability at the mutation, not the route. |
| Projection leak | A public projection includes private fields or ids. | Build the projection from an allowlist. |
| Missing unshared state | A share link exposes a board the owner did not publish. | Derive the shared document, do not filter after serialization. |

## React and canvas

| Term | Failure | Smallest fix |
| --- | --- | --- |
| Stale closure | A handler reads a value from an earlier render. | Read from the store inside the handler, or use a ref. |
| Effect dependency lie | The effect reads a value it does not list. | List it, or move the read out of the effect. |
| Render churn | Every pointer move re-renders the board. | Subscribe to the slice, or keep the value ephemeral. |
| Unstable list identity | Reordering remounts editors and drops focus. | Use the document id as the key. |
| Gesture conflict | Drag and pan both claim the same pointer. | One owner per gesture, decided on pointer down. |
| Geometry in two places | Screen and flow math disagree at zoom. | One conversion helper, one call site. |
| Presence sprawl | Each feature invents its own channel. | One presence schema with typed variants. |
| Thundering herd | Every client reconnects at once. | Jitter the retry and cap concurrency. |
| Optimistic write without reconciliation | The UI keeps a value the server rejected. | Reconcile on ack or roll back on error. |
| Derived state in `useState` | A copy goes stale after the source changes. | Compute during render. |
| Effect as event handler | A user action runs twice under StrictMode. | Run it in the handler. |
| Prop drilling | A value crosses five layers that do not use it. | Context or a store selector at the leaf. |
| Identity churn | A new object every render defeats memo. | Hoist it or memoize on stable inputs. |
| Primitive obsession | `string` stands for five unrelated ids. | Brand the type or use the schema type. |

## UI and accessibility

| Term | Failure | Smallest fix |
| --- | --- | --- |
| Hue-only state | Colour is the only signal. | Add text, icon, or shape. |
| Focus trap | A modal or overlay loses focus to the page behind. | Move focus in, restore it on close, trap Tab. |
| ARIA misuse | A role promises behaviour the element lacks. | Use the native element or implement the keys. |
| Reduced motion missing | Animation ignores the OS setting. | Gate it on `prefers-reduced-motion`. |
| Contrast floor | Text falls below 4.5:1 in one theme. | Use the theme token that meets the floor. |

## Web and runtime

| Term | Failure | Smallest fix |
| --- | --- | --- |
| Server/client leak | A server-only module reaches the client bundle. | Move it behind a server boundary. |
| Unbounded fetch | A list endpoint ignores `limit`. | Cap the page size and paginate. |
| Request waterfall | A page waits for A, then B, then C. | Fetch independent data together. |
| Navigation race | A slow response replaces a newer page. | Abort on navigation or key the result. |
| XSS sink | Untrusted text reaches `innerHTML`. | Render text or sanitize at the boundary. |
| CSP gap | Inline script or `eval` needs `unsafe-inline`. | Remove the sink or hash the script. |
| Secret in client bundle | A key is imported into a client module. | Keep it in the server process. |
| Cache-control gap | A private page is cached by a shared proxy. | `private, no-store` on authenticated responses. |
| Unredacted diagnostics | Logs carry tokens, emails, or document text. | Redact at the logger, not the call site. |

## Refactor on sight

Fix these when the owning file is open, even if the task is elsewhere:

- Whole-record writes and stored derivations.
- Effects that exist to run one user action.
- Duplicate geometry or formatting helpers.
- A second source of truth for selection, focus, or presence.
- Any log line that prints a token or a document body.
