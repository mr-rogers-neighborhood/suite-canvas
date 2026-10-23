import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ownerKeyFromBytes } from "./ownerKey";
import { decodeWords, encodeKey, RECOVERY_WORDLIST } from "./recoveryWords";

const WORD_INDEX = new Map(RECOVERY_WORDLIST.map((word, index) => [word, index]));

/** A canonical 32-byte owner key, the shape `generateOwnerKey` produces. */
const ownerKeyArb = fc.uint8Array({ minLength: 32, maxLength: 32 }).map(ownerKeyFromBytes);

describe("recovery word properties", () => {
  it("round-trips any 32-byte key through its words and back", async () => {
    await fc.assert(
      fc.asyncProperty(ownerKeyArb, async (key) => {
        const phrase = await encodeKey(key);

        expect(phrase.split(" ")).toHaveLength(24);
        await expect(decodeWords(phrase)).resolves.toEqual({ ok: true, key });
      }),
      { numRuns: 60, verbose: true },
    );
  });

  it("never turns a single mistyped word into the original key", async () => {
    await fc.assert(
      fc.asyncProperty(
        ownerKeyArb,
        fc.nat(),
        fc.nat({ max: RECOVERY_WORDLIST.length - 1 }),
        async (key, positionSeed, replacementSeed) => {
          const words = (await encodeKey(key)).split(" ");
          const position = positionSeed % words.length;
          const current = words[position] ?? "";
          const currentIndex = WORD_INDEX.get(current) ?? 0;
          // Pick a different word deterministically from the generated seed.
          const replacement =
            RECOVERY_WORDLIST[
              ((replacementSeed % 2047) + (replacementSeed % 2047 >= currentIndex ? 1 : 0)) % 2048
            ];
          expect(replacement).not.toBe(current);

          const typo = [...words];
          typo[position] = replacement ?? current;
          const decoded = await decodeWords(typo);

          // A checksum of 8 bits detects 255 of every 256 single-word typos, so
          // its promise is narrower than "always an error": a typo may land on
          // another well-formed phrase, but it can never decode to the key the
          // original words stood for. That is the invariant asserted here.
          if (decoded.ok) expect(decoded.key).not.toBe(key);
          else expect(decoded.problem.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 60, verbose: true },
    );
  });
});
