import { describe, it, expect } from "vitest";
import { resolveActingAs } from "./acting-as";

describe("resolveActingAs", () => {
  const groupId = "group-1";
  const realUserId = "real-user-1";

  it("returns the real user when no cookie is set", () => {
    expect(resolveActingAs(null, groupId, realUserId)).toEqual({
      athleteId: realUserId,
      realUserId,
      isActingAsOther: false,
    });
  });

  it("returns the real user when the cookie is an empty string", () => {
    expect(resolveActingAs("", groupId, realUserId)).toEqual({
      athleteId: realUserId,
      realUserId,
      isActingAsOther: false,
    });
  });

  it("returns the impersonated athlete when the cookie matches the current group", () => {
    const raw = JSON.stringify({ athleteId: "client-1", groupId });
    expect(resolveActingAs(raw, groupId, realUserId)).toEqual({
      athleteId: "client-1",
      realUserId,
      isActingAsOther: true,
    });
  });

  it("falls back to the real user when the cookie's groupId doesn't match the current page", () => {
    const raw = JSON.stringify({ athleteId: "client-1", groupId: "some-other-group" });
    expect(resolveActingAs(raw, groupId, realUserId)).toEqual({
      athleteId: realUserId,
      realUserId,
      isActingAsOther: false,
    });
  });

  it("falls back to the real user when the cookie has no athleteId", () => {
    const raw = JSON.stringify({ groupId });
    expect(resolveActingAs(raw, groupId, realUserId)).toEqual({
      athleteId: realUserId,
      realUserId,
      isActingAsOther: false,
    });
  });

  it("falls back to the real user on malformed JSON rather than throwing", () => {
    expect(() => resolveActingAs("{not valid json", groupId, realUserId)).not.toThrow();
    expect(resolveActingAs("{not valid json", groupId, realUserId)).toEqual({
      athleteId: realUserId,
      realUserId,
      isActingAsOther: false,
    });
  });
});
