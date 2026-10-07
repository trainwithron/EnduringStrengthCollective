import { describe, it, expect } from "vitest";
import { planInviteLinks, type InviteLinkRow } from "./invite-link-plan";

const now = new Date("2026-10-10T12:00:00Z");
const day = 86400000;
const link = (id: string, o: Partial<InviteLinkRow> = {}): InviteLinkRow => ({
  id,
  code: "code-" + id,
  createdAt: new Date(now.getTime() - 2 * day).toISOString(),
  expiresAt: new Date(now.getTime() + 5 * day).toISOString(),
  revokedAt: null,
  ...o,
});

describe("one current invite link per group", () => {
  it("is the newest working link that expires, with its days left", () => {
    const plan = planInviteLinks([link("old", { createdAt: new Date(now.getTime() - 6 * day).toISOString() }), link("new", { createdAt: new Date(now.getTime() - 1 * day).toISOString() })], now);
    expect(plan.current?.id).toBe("new");
    expect(plan.current?.daysLeft).toBe(5);
    expect(plan.extra.map((e) => e.id)).toEqual(["old"]);
  });
  it("shows no current link when there is none, and nothing extra", () => {
    expect(planInviteLinks([], now)).toEqual({ current: null, extra: [] });
    expect(planInviteLinks([link("gone", { revokedAt: now.toISOString() }), link("ran", { expiresAt: new Date(now.getTime() - day).toISOString() })], now)).toEqual({ current: null, extra: [] });
  });
  it("a link with no expiry is never the current one: it is flagged, to be cancelled", () => {
    const never = link("never", { expiresAt: null, createdAt: new Date(now.getTime() - 30 * day).toISOString() });
    const plan = planInviteLinks([never], now);
    expect(plan.current).toBeNull();
    expect(plan.extra).toEqual([{ ...never, neverExpires: true }]);
    const withNew = planInviteLinks([never, link("fresh")], now);
    expect(withNew.current?.id).toBe("fresh");
    expect(withNew.extra[0]).toMatchObject({ id: "never", neverExpires: true });
  });
  it("only working links are listed: cancelled and expired ones are gone", () => {
    const plan = planInviteLinks([link("a"), link("b", { revokedAt: now.toISOString() }), link("c", { expiresAt: new Date(now.getTime() - 1000).toISOString() })], now);
    expect(plan.current?.id).toBe("a");
    expect(plan.extra).toEqual([]);
  });
});
