import type { ErrorCode } from "./codes";

/**
 * The English catalogue, and the only locale this build ships.
 *
 * `Record<ErrorCode, string>` is the enforcement: a code without a message is a
 * type error, and a message without a code is an excess property. `{name}`
 * placeholders are filled by `messageFor`.
 *
 * A message names the thing that failed and what the reader can do about it. No
 * message says "something went wrong", because that is the same as saying nothing.
 */
export const english: Record<ErrorCode, string> = {
  "annotation.range.stale":
    "The passage this annotation quoted is no longer in the source. The card keeps the quote; re-anchor it or detach the card.",
  "annotation.range.unanchored":
    "The quoted passage is no longer where this annotation found it, and more than one passage matches now. Re-anchor the annotation or detach the card.",
  "annotation.record.incomplete":
    "This card is missing what an annotation needs ({fields}). Its annotation type declares those fields; a card without them is a plain card.",
  "annotation.source.missing":
    "The source this annotation points into is gone from the workspace. The card keeps its quote.",
  "blueprint.install.empty":
    "This blueprint declares no fields and no starter content, so there is nothing to install.",
  "blueprint.install.unsupported":
    "A blueprint field asks for the kind {kind}, which this build has no editor for. Nothing was installed.",
  "peek.target.missing": "That {kind} is no longer in this workspace.",
};
