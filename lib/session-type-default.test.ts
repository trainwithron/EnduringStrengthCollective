import { describe, it, expect } from "vitest";
import { defaultSessionTypeId, lastTypeByClient, typeMismatchWarning } from "./session-type-default";

const online = { id: "t-online", name: "Online", locationKind: "online" as const };
const inPerson = { id: "t-person", name: "In person", locationKind: "in_person" as const };
const practice = { id: "t-practice", name: "Practice", locationKind: "in_person" as const };

describe("a client's usual session type", () => {
  it("is the type of their most recent session that had one", () => {
    expect(defaultSessionTypeId({ lastTypeId: "t-online", tier: "one_on_one", types: [online, inPerson] })).toBe("t-online");
  });
  it("falls back to the one type that fits their tier", () => {
    expect(defaultSessionTypeId({ lastTypeId: null, tier: "online", types: [online, inPerson] })).toBe("t-online");
    expect(defaultSessionTypeId({ lastTypeId: undefined, tier: "one_on_one", types: [online, inPerson] })).toBe("t-person");
  });
  it("never guesses between two that fit, or for a tier with no match", () => {
    expect(defaultSessionTypeId({ lastTypeId: null, tier: "one_on_one", types: [inPerson, practice] })).toBeNull();
    expect(defaultSessionTypeId({ lastTypeId: null, tier: "group", types: [online, inPerson] })).toBeNull();
    expect(defaultSessionTypeId({ lastTypeId: null, tier: null, types: [online] })).toBeNull();
  });
  it("ignores a last type the coach has since deleted", () => {
    expect(defaultSessionTypeId({ lastTypeId: "gone", tier: "online", types: [online] })).toBe("t-online");
    expect(defaultSessionTypeId({ lastTypeId: "gone", tier: null, types: [online] })).toBeNull();
  });
  it("reads the latest typed session of each client", () => {
    const out = lastTypeByClient([
      { athlete_id: "a", session_type_id: "t-person", start_at: "2026-10-01T10:00:00Z" },
      { athlete_id: "a", session_type_id: "t-online", start_at: "2026-10-05T10:00:00Z" },
      { athlete_id: "a", session_type_id: null, start_at: "2026-10-08T10:00:00Z" },
      { athlete_id: "b", session_type_id: "t-person", start_at: "2026-09-01T10:00:00Z" },
    ]);
    expect(out).toEqual({ a: "t-online", b: "t-person" });
  });
});

describe("a tagged hour used for another type", () => {
  const types = [online, inPerson];
  it("warns, with both names", () => {
    expect(typeMismatchWarning({ windowTypeId: "t-person", chosenTypeId: "t-online", types })).toBe("This hour is set aside for In person, and this session is Online. You can still book it.");
  });
  it("says nothing when they match, when the hour is untagged, or when there is no type", () => {
    expect(typeMismatchWarning({ windowTypeId: "t-online", chosenTypeId: "t-online", types })).toBeNull();
    expect(typeMismatchWarning({ windowTypeId: null, chosenTypeId: "t-online", types })).toBeNull();
    expect(typeMismatchWarning({ windowTypeId: "t-online", chosenTypeId: null, types })).toBeNull();
    expect(typeMismatchWarning({ windowTypeId: "gone", chosenTypeId: "t-online", types })).toBeNull();
  });
});
