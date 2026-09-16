import { describe, it, expect } from "vitest";
import { hasSocialTabAccess } from "./social-access";

describe("hasSocialTabAccess", () => {
  it("hides the tab for a true solo 1-on-1 client — their only membership is their own private group", () => {
    expect(hasSocialTabAccess([{ membershipType: "training", groupKind: "one_on_one" }])).toBe(false);
  });

  it("shows the tab for a real team-group member", () => {
    expect(hasSocialTabAccess([{ membershipType: "training", groupKind: "team" }])).toBe(true);
  });

  it("shows the tab for a real social-kind group member", () => {
    expect(hasSocialTabAccess([{ membershipType: "training", groupKind: "social" }])).toBe(true);
  });

  it("shows the tab the moment a social_only membership exists, even if it's the only one", () => {
    expect(hasSocialTabAccess([{ membershipType: "social_only", groupKind: "one_on_one" }])).toBe(true);
  });

  it("the real dual-membership case: a 1-on-1 training home plus a social_only team membership", () => {
    expect(
      hasSocialTabAccess([
        { membershipType: "training", groupKind: "one_on_one" },
        { membershipType: "social_only", groupKind: "team" },
      ])
    ).toBe(true);
  });

  it("defaults a null/legacy group_kind to team-like (visible), matching this app's existing fallback elsewhere", () => {
    expect(hasSocialTabAccess([{ membershipType: "training", groupKind: null }])).toBe(true);
  });

  it("hides the tab with zero memberships at all (a defensive edge case, not expected in practice)", () => {
    expect(hasSocialTabAccess([])).toBe(false);
  });

  it("shows the tab if ANY one of several memberships qualifies, not just the first", () => {
    expect(
      hasSocialTabAccess([
        { membershipType: "training", groupKind: "one_on_one" },
        { membershipType: "training", groupKind: "one_on_one" },
        { membershipType: "social_only", groupKind: "one_on_one" },
      ])
    ).toBe(true);
  });
});
