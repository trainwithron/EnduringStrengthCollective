import { describe, it, expect } from "vitest";
import { QUIET_SNOOZE_DAYS, quietSnoozeKey, snoozedQuietKeys } from "./quiet-snooze";

const now = new Date("2026-10-06T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

describe("quiet-client snooze", () => {
  it("keys one client in one group", () => {
    expect(quietSnoozeKey("a", "g")).toBe("quiet::a::g");
    expect(quietSnoozeKey("a", "g")).not.toBe(quietSnoozeKey("a", "h"));
  });
  it("keeps a snooze for a week, then the client is flagged again", () => {
    const keys = snoozedQuietKeys(
      [
        { dismissal_key: quietSnoozeKey("a", "g"), created_at: ago(2) },
        { dismissal_key: quietSnoozeKey("b", "g"), created_at: ago(QUIET_SNOOZE_DAYS + 1) },
      ],
      now
    );
    expect(keys.has(quietSnoozeKey("a", "g"))).toBe(true);
    expect(keys.has(quietSnoozeKey("b", "g"))).toBe(false);
  });
  it("ignores feedback that is not about a quiet client", () => {
    expect(snoozedQuietKeys([{ dismissal_key: "expiry-soon::a::g", created_at: ago(1) }], now).size).toBe(0);
  });
});
