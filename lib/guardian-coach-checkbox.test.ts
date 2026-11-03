import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dobGateState } from "./dob-gate";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron, Nov 3: parent consent by email is "annoying to me and I talk to parents before they train with me"; he chose "check box" (step 199).
describe("the coach's parent checkbox for a teen client", () => {
  it("the database counts a tick as permission, in the sign-in gate's answer and in its own write guard; under 13 is never let in", () => {
    const sql = read("supabase/migrations/0444_guardian_coach_checkbox.sql");
    expect(sql).toContain("'state', 'signed',\n        'coach_confirmed', true,");
    expect(sql).toContain("or exists (select 1 from public.guardian_coach_confirmations where athlete_id = p_user);");
    expect(sql).toContain("if v_today < public.age_threshold_date(v_intake_dob, 13) then\n    return false;");
    expect(sql).toContain("revoke all on public.guardian_coach_confirmations from anon, authenticated;");
    // only a coach of a live group where the client trains
    expect(sql).toContain("and public.is_group_coach(a.group_id)\n  ) then\n    raise exception 'not authorized';");
    // the page gate follows 'signed', whatever made it signed
    expect(dobGateState({ isClientOnly: true, dateOfBirth: "2010-07-17", guardianSigned: true, now: new Date("2026-11-03") })).toBe("ok");
    expect(dobGateState({ isClientOnly: true, dateOfBirth: "2015-01-01", guardianSigned: true, now: new Date("2026-11-03") })).toBe("blocked");
  });

  it("the coach ticks or unticks it on the client's profile; the Clients list and the coach notice count it", () => {
    const ui = read("components/coach/guardian-consent-status.tsx");
    expect(ui).toContain("I&apos;ve talked with their parent or guardian, and they&apos;re OK with it.");
    expect(ui).toContain('fetch("/api/guardian-consent/coach-confirm"');
    expect(read("app/api/guardian-consent/coach-confirm/route.ts")).toContain('supabase.rpc("set_guardian_confirmed", { p_athlete: athleteId, p_confirmed: body.confirmed === true })');
    expect(read("app/(coach)/clients/page.tsx")).toContain('admin.from("guardian_coach_confirmations").select("athlete_id").in("athlete_id", ids)');
    expect(read("app/api/intake/minor-consent-notice/route.ts")).toContain("teenWaiting = !signed && !ticked;");
  });
});
