import { describe, expect, it } from "vitest";
import { generateOwnerKey } from "./ownerKey";
import { decodeWords, encodeKey, RECOVERY_WORDLIST, recoveryWordsDocument } from "./recoveryWords";

/** Bytes 0..31 as base64url: fixed, so the typo cases below are not random. */
const OWNER_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
/** Bytes 0..15 as base64url: the 12-word shape. */
const SMALL_KEY = "AAECAwQFBgcICQoLDA0ODw";

describe("RECOVERY_WORDLIST", () => {
  it("is 2048 distinct lowercase words", () => {
    expect(RECOVERY_WORDLIST).toHaveLength(2048);
    expect(new Set(RECOVERY_WORDLIST).size).toBe(2048);
    for (const word of RECOVERY_WORDLIST) expect(word).toMatch(/^[a-z]{3,8}$/u);
  });
});

describe("encodeKey", () => {
  it("writes the 32-byte owner key as 24 words", async () => {
    const words = (await encodeKey(OWNER_KEY)).split(" ");

    expect(words).toHaveLength(24);
    for (const word of words) expect(RECOVERY_WORDLIST).toContain(word);
  });

  it("writes a 16-byte key as 12 words", async () => {
    expect((await encodeKey(SMALL_KEY)).split(" ")).toHaveLength(12);
  });

  it("is deterministic", async () => {
    expect(await encodeKey(OWNER_KEY)).toBe(await encodeKey(OWNER_KEY));
  });

  it("refuses a key it cannot represent", async () => {
    await expect(encodeKey("not-a-key")).rejects.toThrow("16 or 32 byte key");
  });
});

describe("decodeWords", () => {
  it("round-trips the owner key", async () => {
    const phrase = await encodeKey(OWNER_KEY);

    await expect(decodeWords(phrase)).resolves.toEqual({ ok: true, key: OWNER_KEY });
  });

  it("round-trips a freshly generated key", async () => {
    const key = generateOwnerKey();
    const decoded = await decodeWords(await encodeKey(key));

    expect(decoded).toEqual({ ok: true, key });
  });

  it("round-trips the 12-word shape", async () => {
    await expect(decodeWords(await encodeKey(SMALL_KEY))).resolves.toEqual({
      ok: true,
      key: SMALL_KEY,
    });
  });

  it("forgives capitals, padding and extra spacing", async () => {
    const phrase = await encodeKey(SMALL_KEY);

    await expect(
      decodeWords(`  ${phrase.toUpperCase().split(" ").join("   ")}  `),
    ).resolves.toEqual({ ok: true, key: SMALL_KEY });
  });

  it("detects a single mistyped word instead of returning a wrong key", async () => {
    const words = (await encodeKey(OWNER_KEY)).split(" ");
    const typo = [...words];
    typo[4] = typo[4] === "abbey" ? "able" : "abbey";

    const decoded = await decodeWords(typo);

    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.problem).toContain("do not match their checksum");
  });

  it("names a word that is not in the list", async () => {
    const words = (await encodeKey(OWNER_KEY)).split(" ");
    words[5] = "zzzz";

    const decoded = await decodeWords(words);

    expect(decoded).toEqual({
      ok: false,
      problem: '"zzzz" is not a recovery word (word 6). Check the spelling.',
    });
  });

  it("explains a phrase of the wrong length", async () => {
    const decoded = await decodeWords("abbey able above absent");

    expect(decoded).toEqual({
      ok: false,
      problem: "Recovery words are 12 or 24 words; this has 4.",
    });
  });
});

describe("recoveryWordsDocument", () => {
  it("numbers the words and names the workspace", async () => {
    const phrase = await encodeKey(SMALL_KEY);
    const document = recoveryWordsDocument("ws-1", phrase, new Date("2026-01-02T03:04:05.000Z"));

    expect(document).toContain("Workspace: ws-1");
    expect(document).toContain("Created: 2026-01-02T03:04:05.000Z");
    for (const [index, word] of phrase.split(" ").entries()) {
      expect(document).toContain(`${index + 1}. ${word}`);
    }
  });
});
