# Glossary

One definition per term, in the sense this repository uses it. The model behind them is
[architecture.md](architecture.md), and the code identifiers are listed beside each term.

| Term | Means | In code |
| --- | --- | --- |
| workspace | One document, one sync room and one IndexedDB entry for a whole body of work | `WorkspaceDocument`, `meta`, `?workspace=<id>` |
| board | A view inside a workspace that shows cards at positions; it has a name and a tab | `boards`, `boardId` |
| card | The object itself: content, primary type, tags, properties and connectors. It exists with or without a board | `cards`, `Card` |
| placement | Where a card sits on one board, including size and layer rank | `placements`, `Placement` |
| section | A rectangle on one board that groups the cards inside it. Membership is derived from position, never stored | `sections`, `sectionMembership` |
| library | The dock and drawer that find cards not on the board in front of you | `apps/canvas/src/library` |
| type | A card schema: a name, glyph, colour and a set of fields | `types`, `CardType` |
| field | One definition inside a type, with a kind and optional options | `types.<id>.fields`, `FieldDefinition` |
| property | One card's value for one field | `cards.<id>.properties`, `PropertyValue` |
| tag | A free label a card can carry, workspace-wide rather than owned by a type | `tags`, `tagIds` |
| template | A card a type copies when it creates a new card | `CardType.templateCardId` |
| reference | A mention or a `card` property pointing at another card. It is workspace truth and places nothing | `references`, `mention` |
| link | A drawn arrow between two endpoints on a board. It carries no data beyond its label | `edges`, `GraphEdge` |
| connector | A named point on a card's perimeter where a link attaches | `connectors`, `Connector` |
| trash | The soft delete state, recorded as `deletedAt`, from which a card can be restored | `deletedAt`, `trashCard` |
| view | A saved query: search text, scope, facets, grouping and order, stored without any card ids | `views`, `ViewQuery` |
| lens | What a saved view does to the canvas: it dims everything the query did not select | `activeViewId`, `runViewQuery` |
| portal | A card that opens another board and shows a live miniature of it | `PortalNode`, `board` field |
| share projection | The read-only copy of a board, card or selection that a share link opens | `projectWorkspace`, `share-<token>` |
| owner key | The 32-byte secret that proves ownership of a workspace. The relay stores only its hash | `#owner=`, `.suitekey` |
| account | A person in the identity service, mapped to workspace capabilities through an organization role | `services/auth`, `account` |
| licence | A signed Ed25519 token that sets a hosted relay's workspace and byte caps, and never gates a feature | `licence.ts`, `LicenceClaims` |
| presence | Ephemeral signals about a peer: pointer, selection, gesture, caret | `EphemeralStore`, `presence.ts` |
| target | The one shape for "the thing I mean", shared by focus, Follow, Goto and tours | `Target`, `focusTarget` |
| handbook article | In-app documentation stored as a card | `handbook` |
| tutorial | A card whose body holds step blocks | `tutorial.ts` |
| tour | One tutorial's steps presented over the canvas | `TourOverlay` |
| capability | One permission flag a session carries, such as `canPublish` | `sessionCapabilities` |
| inbox | The cards with no placement on any board | `listInboxCards`, `Inbox` tab |
| home board | The board a card returns to and the workspace lands on; the oldest placement wins | `homeBoardId`, `homeBoardId(cardId)` |
| layer rank | The fractional `z` value ordering cards within one board | `placements.<id>.z`, `moveLayer` |
| claim | Registering the first owner key for a workspace, or recording a licence against its id | `/api/workspaces/:id/claim`, `licence claim` |

## Words we do not use

A card is never a node, a note or a document. A node is a React Flow node, a note is the built-in card
type, and a document is the whole workspace document. A placement is never a deletion: say "remove from
board". Trash is never a delete: "delete forever" belongs to purging.

A board is not a canvas, and a workspace is not a file. The canvas is the surface that renders a board, and
a file is a `.suite` backup on disk.

Capitalisation follows the code: workspace, board, card, section and field are lower case in prose unless
they start a sentence. Type names are capitalised when they name a user-defined type ("the Book type"), and
lower case when they name the concept.
