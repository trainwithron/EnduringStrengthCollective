import { describe, expect, it } from "vitest";
import { kindOf, packagePriceCents, rowPriceCents } from "./package-price";

describe("a package's price", () => {
  it("its own price wins (a team, program or coaching package grants no sessions)", () => {
    expect(packagePriceCents({ priceCents: 9900, rateCents: 9900, sessionsGranted: 0 })).toBe(9900);
  });
  it("an older package with no price of its own is rate x sessions, as before", () => {
    expect(packagePriceCents({ priceCents: null, rateCents: 10000, sessionsGranted: 8 })).toBe(80000);
    expect(rowPriceCents({ rate_cents: 10000, sessions_granted: 8 })).toBe(80000);
  });
});

describe("a package's kind", () => {
  it("the chosen kind, else read from what is attached", () => {
    expect(kindOf({ kind: "coaching" })).toBe("coaching");
    expect(kindOf({ groupAccessGroupId: "g" })).toBe("team");
    expect(kindOf({ defaultProgramId: "p" })).toBe("program");
    expect(kindOf({})).toBe("sessions");
  });
});
