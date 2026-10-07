import { describe, it, expect } from "vitest";
import { maskEmail } from "./mask-email";

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("jane.doe@gmail.com")).toBe("j•••@gmail.com");
  });
  it("copes with something that is not an address", () => {
    expect(maskEmail("nope")).toBe("their email");
    expect(maskEmail("@x.com")).toBe("their email");
  });
});
