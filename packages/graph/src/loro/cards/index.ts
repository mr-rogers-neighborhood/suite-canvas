import type { DocContext } from "../context.js";

import { cardMethods } from "./card.js";
import { contentMethods } from "./content.js";
import { referencesMethods } from "./references.js";
import { richTextMethods } from "./richText.js";

/** The whole domain, composed from its slices. */
export function cardsMethods(ctx: DocContext) {
  return {
    ...cardMethods(ctx),
    ...contentMethods(ctx),
    ...richTextMethods(ctx),
    ...referencesMethods(ctx),
  };
}
