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
  "blueprint.install.empty":
    "This blueprint declares no fields and no starter content, so there is nothing to install.",
  "blueprint.install.unsupported":
    "A blueprint field asks for the kind {kind}, which this build has no editor for. Nothing was installed.",
  "peek.target.missing": "That {kind} is no longer in this workspace.",
};
