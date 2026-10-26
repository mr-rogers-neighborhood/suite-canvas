import { describe, expect, it } from "vitest";
import {
  ADMISSION_PENDING_CODE as SERVER_CODE,
  ADMISSION_PENDING_MESSAGE as SERVER_MESSAGE,
} from "../../../../services/auth/src/admission";
import { ADMISSION_PENDING_CODE, ADMISSION_PENDING_MESSAGE } from "./admission";

/**
 * The client cannot import the server package at runtime, so the sentence is
 * copied. This test is the seam: if the server changes its words or its refusal
 * code, the copy fails loudly instead of quietly telling people something else.
 */
describe("the admission sentence", () => {
  it("is the server's sentence, verbatim", () => {
    expect(ADMISSION_PENDING_MESSAGE).toBe(SERVER_MESSAGE);
  });

  it("matches the refusal code the server sends", () => {
    expect(ADMISSION_PENDING_CODE).toBe(SERVER_CODE);
  });
});
