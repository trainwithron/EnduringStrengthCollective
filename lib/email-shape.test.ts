import { describe, it, expect } from "vitest";
import { looksLikeEmail } from "@/lib/email-shape";

describe("the confirm-your-email button only needs an address-shaped email", () => {
  it("accepts ordinary addresses, including ones with the letter s (a lost backslash once refused them)", () => {
    for (const e of ["sarah@gmail.com", "ron@spotlightcoaching.app", "jess.smith+gym@mail.co", "s@s.io"]) expect(looksLikeEmail(e), e).toBe(true);
  });
  it("rejects what is not an address", () => {
    for (const e of ["no-at-sign", "a@b", "a@b.c", "two words@gmail.com", "@gmail.com", "sarah@", ""]) expect(looksLikeEmail(e), e).toBe(false);
  });
});
