import { describe, it, expect } from "vitest";
import { capFirst, termText } from "./term-text";

describe("swapped words read like ordinary words", () => {
  it("capitalises only the first letter, where the word starts a label", () => {
    expect(capFirst("clients")).toBe("Clients");
    expect(capFirst("football players")).toBe("Football players");
    expect(capFirst("")).toBe("");
    expect(capFirst("Members")).toBe("Members");
  });
  it("is lowercase mid-sentence and proper case at the start of a label", () => {
    const athletes = { client: { kind: "preset" as const, value: "athlete" } };
    expect(termText(athletes, "client", "plural")).toBe("athletes");
    expect(termText(athletes, "client", "plural", { cap: true })).toBe("Athletes");
    expect(`Add ${termText(athletes, "client", "singular")}`).toBe("Add athlete");
    expect(termText({}, "client", "plural", { cap: true })).toBe("Clients");
  });
  it("custom words and possessives follow the same rule", () => {
    const custom = { client: { kind: "custom" as const, value: "swimmers" } };
    expect(termText(custom, "client", "plural", { cap: true })).toBe("Swimmers");
    expect(termText({ client: { kind: "preset" as const, value: "player" } }, "client", "possessive", { cap: true })).toBe("Player's");
  });
});
