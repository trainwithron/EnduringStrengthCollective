import { describe, expect, it } from "vitest";
import { describeAction, describeChanges } from "./audit-format";

describe("describeChanges", () => {
  it("shows old and new for an update and just the value for an insert", () => {
    expect(describeChanges({ is_platform_admin: { old: false, new: true } })).toBe("is_platform_admin: false \u2192 true");
    expect(describeChanges({ intake_required: { new: true } })).toBe("intake_required: true");
  });
  it("words nulls and joins several columns", () => {
    expect(describeChanges({ claimed_at: { old: null, new: "2026-10-05" }, balance: { old: 3, new: 5 } })).toBe("claimed_at: empty \u2192 2026-10-05; balance: 3 \u2192 5");
  });
  it("is empty for nothing", () => {
    expect(describeChanges(null)).toBe("");
    expect(describeChanges({})).toBe("");
  });
});

describe("describeAction", () => {
  it("says who acted in plain words", () => {
    expect(describeAction("update", "service_role")).toBe("Changed by the server");
    expect(describeAction("update", "sql_editor")).toBe("Changed from the SQL editor");
    expect(describeAction("insert", "authenticated")).toBe("Created by a signed-in user");
    expect(describeAction("blocked_write", "authenticated")).toBe("Blocked attempt");
  });
});
