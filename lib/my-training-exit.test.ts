import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTING_AS_COOKIE, ACTING_AS_SELF_COOKIE } from "@/lib/acting-as";
import { VIEW_OVERRIDE_COOKIE } from "@/lib/pwa";
import { isCoachOnlyPath, MY_TRAINING_COOKIES, shouldLeaveMyTraining } from "@/lib/my-training-exit";

const G = "060017b5-e613-4204-a101-c6a14c3a9630";

describe("landing on a coach page ends a visit to My training", () => {
  it("uses the same cookie names the My training entry points set", () => {
    expect(MY_TRAINING_COOKIES.actingAs).toBe(ACTING_AS_COOKIE);
    expect(MY_TRAINING_COOKIES.actingAsSelf).toBe(ACTING_AS_SELF_COOKIE);
    expect(MY_TRAINING_COOKIES.viewOverride).toBe(VIEW_OVERRIDE_COOKIE);
  });
  it("with the cookies set, Home, Programs, Calendar, Clients and the coach pages of a group end the visit", () => {
    for (const p of ["/dashboard", "/programs", "/calendar", "/clients", "/group-calendar", `/groups/${G}/dashboard`, `/groups/${G}/business`, `/groups/${G}/business/packages`, `/groups/${G}/clients`, `/groups/${G}/athletes/abc`]) {
      expect(shouldLeaveMyTraining(p, "1"), p).toBe(true);
    }
  });
  it("it never ends on the client's own pages, on My training itself, or when the visit was not started", () => {
    for (const p of ["/my-training", "/my-training/open", `/groups/${G}`, `/groups/${G}/programs/x`, `/groups/${G}/calendar`, `/groups/${G}/settings`, `/sessions/abc`, "/notifications"]) {
      expect(shouldLeaveMyTraining(p, "1"), p).toBe(false);
    }
    expect(shouldLeaveMyTraining("/dashboard", undefined)).toBe(false);
    expect(shouldLeaveMyTraining("/dashboard", "")).toBe(false);
    expect(isCoachOnlyPath("/dashboard")).toBe(true);
  });
  it("the middleware clears all three cookies for that request (so the coach screen renders, not a redirect into the client view)", () => {
    const mw = readFileSync(join(__dirname, "..", "lib/supabase/middleware.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(mw).toContain("shouldLeaveMyTraining(pathname, request.cookies.get(MY_TRAINING_COOKIES.actingAsSelf)?.value)");
    expect(mw).toContain("request.cookies.delete(name)");
    expect(mw).toContain('response.cookies.set(name, "", { path: "/", maxAge: 0 })');
  });
});
