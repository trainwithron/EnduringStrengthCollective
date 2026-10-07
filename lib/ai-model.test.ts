import { describe, it, expect } from "vitest";
import { modelCandidates, FALLBACK_MODEL } from "./ai-model";

describe("model candidates", () => {
  it("uses the default when nothing is configured, with the fallback to retry", () => {
    expect(modelCandidates(undefined, "claude-sonnet-5")).toEqual(["claude-sonnet-5", FALLBACK_MODEL]);
    expect(modelCandidates("  ", "claude-sonnet-5")).toEqual(["claude-sonnet-5", FALLBACK_MODEL]);
  });
  it("uses the configured id", () => {
    expect(modelCandidates(" claude-opus-5-5 ", "claude-sonnet-5")).toEqual(["claude-opus-5-5", FALLBACK_MODEL]);
  });
  it("has nothing different to retry with when the fallback is already the one in use", () => {
    expect(modelCandidates(FALLBACK_MODEL, "claude-sonnet-5")).toEqual([FALLBACK_MODEL, null]);
  });
  it("prefers an id that already worked after a retry", () => {
    expect(modelCandidates(undefined, "claude-sonnet-5", FALLBACK_MODEL)).toEqual([FALLBACK_MODEL, null]);
  });
});
