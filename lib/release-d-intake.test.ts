import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAR_Q_QUESTIONS } from "@/lib/par-q-questions";
import { validateIntakeSubmission } from "@/lib/intake-submit";
import { screeningStatus, asDecision, decisionLine, DECISION_BUTTON } from "@/lib/par-q-outcome";
import { waiverVersionKey } from "@/lib/waiver-server";
import { assignNotices } from "@/lib/assign-notice";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const answers = (yes: number[] = []) => PAR_Q_QUESTIONS.map((q, i) => ({ question: "tampered " + q, answer: yes.includes(i) }));

describe("the server checks the health form", () => {
  it("needs every question answered, a typed name and the box ticked; the question text is always ours", () => {
    const ok = validateIntakeSubmission({ answers: answers(), signedName: "  Sam Rivera ", accepted: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.signedName).toBe("Sam Rivera");
      expect(ok.answers.map((a) => a.question)).toEqual(PAR_Q_QUESTIONS);
    }
    expect(validateIntakeSubmission({ answers: answers(), signedName: "Sam", accepted: false }).ok).toBe(false);
    expect(validateIntakeSubmission({ answers: answers(), signedName: " ", accepted: true }).ok).toBe(false);
    expect(validateIntakeSubmission({ answers: answers().slice(1), signedName: "Sam", accepted: true }).ok).toBe(false);
    expect(validateIntakeSubmission({ answers: [...answers().slice(1), { question: "x", answer: "yes" }], signedName: "Sam", accepted: true }).ok).toBe(false);
    expect(validateIntakeSubmission(null).ok).toBe(false);
  });
});

describe("what a screening means", () => {
  it("no yes answers is clear; any yes is talk first", () => {
    expect(screeningStatus(PAR_Q_QUESTIONS.map((q) => ({ question: q, answer: false })))).toBe("clear");
    expect(screeningStatus(PAR_Q_QUESTIONS.map((q, i) => ({ question: q, answer: i === 3 })))).toBe("talk_first");
  });
  it("the coach's decisions are three, and the line says who reviewed and when", () => {
    expect(asDecision("hold")).toBe("hold");
    expect(asDecision("banana")).toBeNull();
    expect(decisionLine("modified", "2026-10-12T10:00:00Z")).toBe(`Reviewed by you: ${DECISION_BUTTON.modified} (Oct 12)`);
    expect(decisionLine(null, null)).toBeNull();
  });
  it("a client on hold gets a plain note on the Assign screen", () => {
    expect(assignNotices([{ name: "Sam", dateOfBirth: "1990-01-01", parqFlagged: false, onHold: true }])).toEqual(["Sam is on hold after their health screening. Check with them before you assign."]);
  });
});

describe("the waiver signed is a record of exactly those words", () => {
  const snap = (text: string, name: string, at: string) => `Waiver accepted for Org on ${at}.\n\n${text}\n\nSigned by typing: ${name}`;
  it("the same words give the same version key whoever signs and whenever; changed words give a new one", () => {
    const a = waiverVersionKey(snap("I accept the risks.", "Sam", "2026-10-01T00:00:00Z"));
    expect(waiverVersionKey(snap("I accept the risks.", "Alex", "2026-11-01T00:00:00Z"))).toBe(a);
    expect(waiverVersionKey(snap("I accept the risks. And more.", "Sam", "2026-10-01T00:00:00Z"))).not.toBe(a);
    expect(a).toMatch(/^2026-10-05-draft-1\+[0-9a-f]{12}$/);
  });
});

describe("wiring", () => {
  it("the form is finished by one server call and the browser no longer writes the completion columns", () => {
    const form = src("components/intake/intake-form.tsx");
    expect(form).toContain('fetch("/api/intake/submit"');
    expect(form).not.toContain("completed_at: new Date().toISOString()");
    expect(form).not.toContain("/api/legal/accept");
    const route = src("app/api/intake/submit/route.ts");
    expect(route).toContain("validateIntakeSubmission(body)");
    expect(route).toContain("versions: { waiver: waiverVersionKey(snapshot) }");
    // the signature is recorded BEFORE the form is marked complete, so there is nothing to roll back (a rollback could fail or race a second tap and leave a finished form with no signature)
    expect(route).toContain("finishIntake(");
    expect(route).toContain("buildServerWaiverSnapshot(db, user.id, signing)");
    expect(route).not.toContain("update({ completed_at: null, waiver_accepted: false })");
    expect(src("supabase/migrations/0386_intake_server_completes.sql")).toContain("Your health form is saved by the server.");
  });
  it("the guard is switched on by its own step, run after the new code is live, so the old form keeps working until then", () => {
    const m386 = src("supabase/migrations/0386_intake_server_completes.sql");
    const m388 = src("supabase/migrations/0388_intake_guard_trigger.sql");
    expect(m386).not.toContain("create trigger client_intake_guard_completion");
    expect(m388).toContain("create trigger client_intake_guard_completion");
    const build = src("scripts/build-paste-files.mjs");
    expect(build).toContain('id: "release-cp"');
    expect(build).toContain("run AFTER the Release D code is live");
  });
  it("step 138 (held) leaves out a gym owner or admin who holds a client seat", () => {
    const build = src("scripts/build-paste-files.mjs");
    expect(build.split("om.role in ('owner', 'admin')").length - 1).toBeGreaterThanOrEqual(2); // the step and the read-only list
    expect(src("supabase/apply/apply-step138-flag-clients-without-intake.sql")).toContain("om.role in ('owner', 'admin')");
    expect(src("supabase/apply/check-intake-flag-list.sql")).toContain("om.role in ('owner', 'admin')");
  });
  it("every client page is behind the form, not just /groups, and a workout link comes back after it", () => {
    const mw = src("lib/supabase/middleware.ts");
    expect(mw).toContain('export const INTAKE_GATED_PREFIXES = ["/groups", "/sessions", "/my-training", "/partners"];');
    expect(mw).toContain("INTAKE_GATED_PREFIXES.some(");
    expect(mw).toContain('redirectUrl.searchParams.set("next", pathname + request.nextUrl.search)');
  });
  it("the coach decides on a flagged screening with three buttons and the decision shows on the profile", () => {
    expect(src("components/coach/desktop/parq-flag-notice.tsx")).toContain("COACH_DECISIONS.map(");
    expect(src("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx")).toContain("reviewLine={decisionLine(");
  });
});

import { finishIntake } from "@/lib/intake-finish";
import { buildServerWaiverSnapshot } from "@/lib/waiver-server";

// A database that knows nothing: a brand-new client has no intake row at all. Every read answers "nothing here".
const emptyDb: any = {
  from: () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: null }),
    };
    return chain;
  },
  storage: { from: () => ({ download: async () => ({ data: null }), upload: async () => ({ error: null }) }) },
};

describe("a brand-new client can finish the health form (the signature record is made before the form is marked complete)", () => {
  it("the record can be built for a client with NO intake row yet, from the name, time and group being signed now", async () => {
    const withSigning = await buildServerWaiverSnapshot(emptyDb, "u1", { groupId: "g1", signedName: "Sam Rivera", signedAtIso: "2026-10-17T12:00:00.000Z" });
    expect(withSigning).toContain("Sam Rivera");
    // the old reading form (the 'accept again' route) still needs a finished intake
    expect(await buildServerWaiverSnapshot(emptyDb, "u1")).toBeNull();
    // and nothing to sign means no record
    expect(await buildServerWaiverSnapshot(emptyDb, "u1", { groupId: "g1", signedName: "", signedAtIso: "2026-10-17T12:00:00.000Z" })).toBeNull();
  });
  it("the real submit order on a new client: record saved, then the intake marked complete", async () => {
    const calls: string[] = [];
    let intakeComplete = false;
    const result = await finishIntake(
      { groupId: "g1", signedName: "Sam Rivera", now: new Date("2026-10-17T12:00:00.000Z") },
      {
        buildSnapshot: (signing) => buildServerWaiverSnapshot(emptyDb, "u1", signing),
        record: async (snapshot) => {
          calls.push("record");
          expect(intakeComplete).toBe(false); // nothing is marked complete before the record exists
          return snapshot.includes("Sam Rivera");
        },
        writeComplete: async (at) => {
          calls.push("write");
          intakeComplete = at === "2026-10-17T12:00:00.000Z";
          return true;
        },
      }
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["record", "write"]);
    expect(intakeComplete).toBe(true);
  });
  it("when the record cannot be saved, nothing is marked complete", async () => {
    let wrote = false;
    const result = await finishIntake(
      { groupId: "g1", signedName: "Sam Rivera", now: new Date() },
      {
        buildSnapshot: (signing) => buildServerWaiverSnapshot(emptyDb, "u1", signing),
        record: async () => false,
        writeComplete: async () => {
          wrote = true;
          return true;
        },
      }
    );
    expect(result).toEqual({ ok: false, step: "record" });
    expect(wrote).toBe(false);
  });
  it("when the record cannot even be built, nothing is marked complete; when the completion write fails the client is told to try again", async () => {
    let wrote = false;
    const none = await finishIntake({ groupId: "", signedName: "Sam", now: new Date() }, { buildSnapshot: (s) => buildServerWaiverSnapshot(emptyDb, "u1", s), record: async () => true, writeComplete: async () => ((wrote = true), true) });
    expect(none).toEqual({ ok: false, step: "record" });
    expect(wrote).toBe(false);
    const failedWrite = await finishIntake({ groupId: "g1", signedName: "Sam", now: new Date() }, { buildSnapshot: async () => "text", record: async () => true, writeComplete: async () => false });
    expect(failedWrite).toEqual({ ok: false, step: "write" });
  });
});
