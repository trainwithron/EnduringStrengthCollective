import { describe, expect, it } from "vitest";
import { generateKioskPin } from "./kiosk-pin";

describe("generateKioskPin", () => {
  it("always returns a 4-digit string", () => {
    for (let i = 0; i < 50; i++) {
      const pin = generateKioskPin();
      expect(pin).toMatch(/^\d{4}$/);
    }
  });

  it("never returns a leading-zero-only value below 1000", () => {
    for (let i = 0; i < 50; i++) {
      const pin = Number(generateKioskPin());
      expect(pin).toBeGreaterThanOrEqual(1000);
      expect(pin).toBeLessThanOrEqual(9999);
    }
  });
});
