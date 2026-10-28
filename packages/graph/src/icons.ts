import { z } from "zod";

/**
 * An icon, stored as a reference rather than as a picture.
 *
 * `prefix:name` is Iconify's own identifier ("lucide:check"), so a document names
 * an icon the same way the library that draws it does. The alternative — storing
 * the SVG body on the card — duplicates bytes per card and freezes the icon at
 * the moment it was chosen, which means a restyle never reaches the cards already
 * using it.
 *
 * The cost is resolution: the drawing needs a set that contains the prefix. The
 * bundled sets cover the common case offline, and anything else arrives through
 * the picker's "Add more icon sets", cached on the device.
 */
export const iconRefSchema = z
  .string()
  .min(3)
  .max(64)
  // A prefix and a name, one colon, no spaces: an unqualified name would be a
  // guess about which set the author meant.
  .regex(/^[a-z0-9-]+:[a-z0-9][a-z0-9-]*$/i);

export type IconRef = z.infer<typeof iconRefSchema>;

/** Whether a stored value is a usable icon reference. */
export function isIconRef(value: unknown): value is IconRef {
  return typeof value === "string" && iconRefSchema.safeParse(value).success;
}

/** The set an icon belongs to, or null when the value is not a reference. */
export function iconPrefix(ref: string | undefined): string | null {
  if (ref === undefined) return null;
  const at = ref.indexOf(":");
  return at > 0 ? ref.slice(0, at) : null;
}
