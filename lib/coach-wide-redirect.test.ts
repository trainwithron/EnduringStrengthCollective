import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));

import { coachWideRedirectTarget } from "./coach-wide-redirect";

const g = (id: string, name: string, kind: "one_on_one" | "team" | "social", orgId = "o1") => ({ id, name, kind, orgId });

describe("coach-wide pages leave a one-on-one client's group", () => {
  const groups = [g("c1", "Amber Belt", "one_on_one"), g("t1", "Home Team", "team"), g("s1", "Alumni", "social")];
  it("sends a one-on-one group's address to the coach's usual group, keeping the page", () => {
    expect(coachWideRedirectTarget(groups, "c1", "business/packages")).toBe("/groups/s1/business/packages");
    expect(coachWideRedirectTarget(groups, "c1", "/availability")).toBe("/groups/s1/availability");
  });
  it("leaves a team or social group alone", () => {
    expect(coachWideRedirectTarget(groups, "t1", "business")).toBeNull();
    expect(coachWideRedirectTarget(groups, "s1", "business")).toBeNull();
  });
  it("leaves a coach with only one-on-one clients alone (there is nowhere better to go)", () => {
    expect(coachWideRedirectTarget([g("c1", "A", "one_on_one"), g("c2", "B", "one_on_one")], "c1", "business")).toBeNull();
  });
  it("leaves a group the viewer does not coach alone", () => {
    expect(coachWideRedirectTarget(groups, "other", "business")).toBeNull();
  });
  it("only looks inside the same organization", () => {
    const mixed = [g("c1", "A", "one_on_one", "o1"), g("t9", "Other org team", "team", "o2")];
    expect(coachWideRedirectTarget(mixed, "c1", "business")).toBeNull();
  });
});
