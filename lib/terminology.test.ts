import { describe, expect, it } from "vitest";
import { resolveTerm, type TerminologyOverrides } from "./terminology";

describe("resolveTerm", () => {
  it("returns the built-in default when there's no override", () => {
    expect(resolveTerm({}, "client", "plural")).toBe("clients");
    expect(resolveTerm({}, "client", "possessive")).toBe("client's");
    expect(resolveTerm({}, "coach", "plural")).toBe("coaches");
  });

  it("resolves a preset override to its hand-authored grammar form", () => {
    const overrides: TerminologyOverrides = { client: { kind: "preset", value: "athlete" } };
    expect(resolveTerm(overrides, "client", "singular")).toBe("athlete");
    expect(resolveTerm(overrides, "client", "plural")).toBe("athletes");
    expect(resolveTerm(overrides, "client", "possessive")).toBe("athlete's");
  });

  it("resolves a custom override literally in every form, no grammar", () => {
    const overrides: TerminologyOverrides = { session: { kind: "custom", value: "lift" } };
    expect(resolveTerm(overrides, "session", "singular")).toBe("lift");
    expect(resolveTerm(overrides, "session", "plural")).toBe("lift");
    expect(resolveTerm(overrides, "session", "possessive")).toBe("lift");
  });

  it("falls back to default when a saved preset id no longer exists", () => {
    const overrides: TerminologyOverrides = { client: { kind: "preset", value: "not-a-real-preset" } };
    expect(resolveTerm(overrides, "client", "plural")).toBe("clients");
  });

  it("leaves an unrelated term's default untouched by another term's override", () => {
    const overrides: TerminologyOverrides = { client: { kind: "preset", value: "athlete" } };
    expect(resolveTerm(overrides, "program", "singular")).toBe("program");
  });
});
