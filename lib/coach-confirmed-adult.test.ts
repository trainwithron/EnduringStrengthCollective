import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { ageStatusOf, athleteAgeStatus, loadConfirmedAdults } from "./youth-block";
import { assignNotices } from "./assign-notice";
import { resolveShowName } from "./share-name";
import { minorSafetyLine } from "./minor-safety";
import { DAYS_ONLY_CARD } from "./nutrition-cards";

// Step 230 (Ron, Nov 24: "I can vouch for everyone that doesn't have a birthday submitted. They are over 18. Give them the full feature list ... give them the bars.").
const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const AS_OF = new Date("2026-11-24T12:00:00Z");
const ADULT_DOB = "1990-05-01";
const TEEN_DOB = "2011-05-01";

// A stand-in for supabase.rpc("confirmed_adult_ids") (and the intake read athleteAgeStatus makes).
function fakeDb(confirmed: string[] | "error", dob: string | null = null) {
  const calls: string[][] = [];
  return {
    calls,
    rpc: async (_name: string, args: { p_ids: string[] }) => {
      calls.push(args.p_ids);
      if (confirmed === "error") return { data: null, error: { message: "function public.confirmed_adult_ids does not exist" } };
      return { data: args.p_ids.filter((id) => confirmed.includes(id)), error: null };
    },
    from: () => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: dob ? { date_of_birth: dob } : null, error: null }) };
      return q;
    },
  } as any;
}

describe("the one adult rule", () => {
  it("a birthday of 18+ is an adult; no birthday is an adult only on a coach's confirmation; a birthday under 18 always wins", () => {
    expect(ageStatusOf(ADULT_DOB, false, AS_OF)).toBe("adult");
    expect(ageStatusOf(null, false, AS_OF)).toBe("unknown");
    expect(ageStatusOf(null, true, AS_OF)).toBe("adult");
    expect(ageStatusOf(TEEN_DOB, true, AS_OF)).toBe("minor");
    expect(ageStatusOf(TEEN_DOB, false, AS_OF)).toBe("minor");
  });

  it("asks the database once per 500 people; a failed read (or no step 230 yet) confirms nobody", async () => {
    const db = fakeDb(["a", "c"]);
    expect([...(await loadConfirmedAdults(db, ["a", "b", "c", "a", ""]))].sort()).toEqual(["a", "c"]);
    expect(db.calls).toEqual([["a", "b", "c"]]);
    const many = fakeDb([]);
    await loadConfirmedAdults(many, Array.from({ length: 1001 }, (_, i) => `p${i}`));
    expect(many.calls.map((c: string[]) => c.length)).toEqual([500, 500, 1]);
    expect((await loadConfirmedAdults(fakeDb("error"), ["a"])).size).toBe(0);
    // an answer shaped as rows is read too
    const rows = { rpc: async () => ({ data: [{ confirmed_adult_ids: "a" }], error: null }) } as any;
    expect([...(await loadConfirmedAdults(rows, ["a"]))]).toEqual(["a"]);
  });

  it("the builder: a confirmed client with no birthday gets no youth limits; a teen's birthday still does", async () => {
    expect(await athleteAgeStatus(fakeDb(["a"]), "a")).toBe("adult");
    expect(await athleteAgeStatus(fakeDb([]), "a")).toBe("unknown");
    expect(await athleteAgeStatus(fakeDb(["a"], TEEN_DOB), "a")).toBe("minor");
    // a birthday on file is never asked about
    const withDob = fakeDb(["a"], ADULT_DOB);
    expect(await athleteAgeStatus(withDob, "a")).toBe("adult");
    expect(withDob.calls).toEqual([]);
  });

  it("the Assign screen does not call a confirmed client 'no birthdate on file'", () => {
    const notes = assignNotices(
      [
        { name: "Robyn", dateOfBirth: null, coachConfirmedAdult: true, parqFlagged: false },
        { name: "Stan", dateOfBirth: null, parqFlagged: false },
        { name: "Sam", dateOfBirth: TEEN_DOB, coachConfirmedAdult: true, parqFlagged: false },
      ],
      AS_OF
    );
    expect(notes.join(" ")).not.toContain("Robyn");
    expect(notes).toContain("Stan has no birthdate on file. Check their age before you assign.");
    expect(notes[0]).toMatch(/^Sam is under 18/);
  });

  it("a confirmed client's name can show on a shared picture, like any adult's", () => {
    expect(resolveShowName(null, null, AS_OF, true)).toBe(true);
    expect(resolveShowName(false, null, AS_OF, true)).toBe(false);
    expect(resolveShowName(null, null, AS_OF)).toBe(false);
    expect(resolveShowName(true, TEEN_DOB, AS_OF, true)).toBe(false);
  });

  it("no 'age unknown' line for a confirmed client on the coach's nutrition page", () => {
    expect(minorSafetyLine({ ageYears: null, phase: "fat_loss", clientName: "Robyn", confirmedAdult: true })).toBeNull();
    expect(minorSafetyLine({ ageYears: null, phase: "fat_loss", clientName: "Robyn" })).toMatch(/No date of birth on file/);
  });

  it("the Nutrition card says how to clear the days-only state", () => {
    expect(DAYS_ONLY_CARD).toContain("tick 18 or older on their page");
  });
});

describe("the name boards (lib/minor-names.ts)", () => {
  beforeEach(() => vi.resetModules());
  it("a confirmed client with no birthday shows in full; an unconfirmed one and a teen stay shortened", async () => {
    const intake = [{ athlete_id: "teen", date_of_birth: TEEN_DOB }, { athlete_id: "adult", date_of_birth: ADULT_DOB }];
    vi.doMock("@/lib/supabase/service-role", () => ({
      createServiceRoleClient: () => ({
        rpc: async (_n: string, args: { p_ids: string[] }) => ({ data: args.p_ids.filter((id) => id === "vouched" || id === "teen"), error: null }),
        from: () => {
          const q: any = { select: () => q, in: async () => ({ data: intake, error: null }) };
          return q;
        },
      }),
    }));
    const { loadNameProtectedIds } = await import("./minor-names");
    const protectedIds = await loadNameProtectedIds(["vouched", "unknown", "teen", "adult"]);
    expect([...protectedIds].sort()).toEqual(["teen", "unknown"]);
    vi.doUnmock("@/lib/supabase/service-role");
  });
});

describe("where the rule is used (and where it is not)", () => {
  it("every adult-or-not decision goes through it", () => {
    const uses: [string, string][] = [
      ["lib/youth-block.ts", "ageStatusOf(dob, (await loadConfirmedAdults(supabase, [athleteId])).has(athleteId))"],
      ["lib/minor-names.ts", "ageStatusOf(dobById.get(id) ?? null, confirmed.has(id))"],
      ["lib/share-name.ts", "ageStatusOf(dateOfBirth, coachConfirmedAdult, asOf)"],
      ["lib/share-identity.ts", "resolveShowName(stored, dob, new Date(), confirmedAdult)"],
      ["lib/shared-workout.ts", "authorConfirmedAdult"],
      ["lib/assign-notice.ts", "ageStatusOf(c.dateOfBirth, !!c.coachConfirmedAdult, asOf)"],
      ["components/coach/desktop/program-assign-panel.tsx", "coachConfirmedAdult: confirmedAdults.has(id)"],
      ["app/(coach)/groups/[groupId]/settings/page.tsx", "ageStatusOf(ownDob, ownConfirmedAdult)"],
      ["app/(coach)/groups/[groupId]/calendar/[date]/page.tsx", "await loadConfirmedAdults(supabase, bookingAthleteIds)"],
      ["app/api/bookings/[bookingId]/video-room/route.ts", "!confirmedAdult && (!intake?.date_of_birth"],
      ["app/(coach)/groups/[groupId]/nutrition/page.tsx", "hideFatLoss: age == null ? !(await loadConfirmedAdults(supabase, [athleteId])).has(athleteId) : age < 18"],
      ["components/coach/nutrition/client-nutrition.tsx", "ageKnown={ageYears != null || confirmedAdult}"],
      ["app/api/cron/nutrition-checkin-suggestions/route.ts", "rationale: dob || confirmedAdult ?"],
    ];
    for (const [file, text] of uses) expect(src(file), file).toContain(text);
    // nothing decides adult-or-not from the date alone any more
    for (const file of ["lib/minor-names.ts", "lib/share-name.ts", "lib/assign-notice.ts", "app/(coach)/groups/[groupId]/settings/page.tsx"]) expect(src(file), file).not.toMatch(/ageStatusFromDob\(/);
  });

  it("parent and guardian steps still follow a real birthday only", () => {
    for (const file of ["lib/guardian-consent-server.ts", "lib/guardian-view.ts", "lib/dob-gate.ts", "app/api/intake/minor-consent-notice/route.ts", "app/(coach)/clients/page.tsx"]) {
      expect(src(file), file).not.toContain("loadConfirmedAdults");
      expect(src(file), file).not.toContain("ageStatusOf");
    }
    const mig = src("supabase/migrations/0474_coach_confirmed_adult.sql");
    // the guardian functions are not redefined
    for (const fn of ["guardian_consent_state", "set_guardian_confirmed", "guardian_link_allowed", "sms_consent_for_dispatch"]) expect(mig).not.toContain(`function public.${fn}(`);
  });

  it("the checkbox is the coach's only, shown only with no birthday on file", () => {
    const page = src("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("const showAdultConfirm = !selfView && !intake?.date_of_birth && !(profileDetails?.birthday && isMinorDob(profileDetails.birthday));");
    expect(page).toContain("{showAdultConfirm && <AdultConfirmToggle athleteId={params.athleteId} initial={adultConfirmed} />}");
    expect(src("components/coach/adult-confirm-toggle.tsx")).toContain("18 or older (no birthday on file)");
    expect(src("app/api/clients/adult-confirm/route.ts")).toContain('supabase.rpc("set_adult_confirmed"');
  });

  it("nobody can vouch for their own age: not in the database, not through the route, and the box never shows on your own page", () => {
    expect(src("supabase/migrations/0474_coach_confirmed_adult.sql")).toContain("if auth.uid() is null or p_athlete = auth.uid() or not exists (");
    expect(src("app/api/clients/adult-confirm/route.ts")).toContain("if (athleteId === user.id) return NextResponse.json");
    const page = src("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    // selfView is the page for your own id
    expect(page).toContain("const selfView = !!user && params.athleteId === user.id;");
    expect(page).toContain("const showAdultConfirm = !selfView && ");
  });
});

describe("paste 230", () => {
  const apply = src("supabase/apply/apply-step230-0474.sql");
  const undo = src("supabase/apply/undo-step230-0474.sql");
  const mig = src("supabase/migrations/0474_coach_confirmed_adult.sql").trimEnd();
  it("is ASCII, holds the migration as written, and is rehearsed", () => {
    for (const t of [apply, undo, mig]) expect(/[^\x00-\x7f]/.test(t)).toBe(false);
    expect(apply).toContain(mig);
    expect(src("scripts/sql-tests/harness.mjs")).toContain('"0474"');
    expect(src("supabase/REHEARSAL.md")).toContain("| 0474 |");
    expect(createHash("sha256").update(apply).digest("hex").slice(0, 16)).toMatch(/^[0-9a-f]{16}$/);
  });
  it("confirms Ron's clients with no birthday in his name, and leaves anyone with a birthday out", () => {
    expect(apply).toContain("insert into public.client_adult_confirmations (athlete_id, confirmed_by)");
    expect(apply).toContain("not exists (select 1 from public.client_intake ci where ci.athlete_id = a.profile_id and ci.date_of_birth is not null)");
    expect(apply).toContain("on conflict (athlete_id) do nothing");
    expect(apply).toContain("as ron_confirmed");
    // platform-wide nothing is confirmed by the migration itself
    expect(mig).not.toContain("insert into public.client_adult_confirmations (athlete_id, confirmed_by)\nselect");
  });
  it("a confirmation counts only while the coach who made it coaches every live group the client is in, training or social (a second, made-up coach account never counts)", () => {
    expect(mig).toContain("where c.athlete_id = p_person and c.confirmed_by is not null");
    expect(mig).toContain("where m.profile_id = p_person and m.role = 'athlete'\n            and not exists");
    expect(mig).toContain("and not exists (select 1 from public.group_memberships cc where cc.group_id = m.group_id and cc.profile_id = c.confirmed_by and cc.role = 'coach')");
    expect(mig).toContain("join public.groups g on g.id = m.group_id and g.archived_at is null");
  });
  it("the undo puts the four age checks back exactly (md5 checked)", () => {
    for (const md5 of ["4ce90722aeaf6b38d53f56a86f231d9f", "d67ec0667c1284d0e24afd70c874a468", "2251b9649248307314e2d07596444258", "23603214443916629981a3cee33125e6"]) {
      expect(undo).toContain(md5);
      expect(apply).toContain(md5); // the precheck
    }
  });
});
