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
    expect(route).toContain("const completedAt = new Date().toISOString();");
    expect(route).toContain("validateIntakeSubmission(body)");
    expect(route).toContain("versions: { waiver: waiverVersionKey(snapshot) }");
    // a signature that cannot be recorded is rolled back, never left looking complete
    expect(route).toContain("update({ completed_at: null, waiver_accepted: false })");
    expect(src("supabase/migrations/0386_intake_server_completes.sql")).toContain("Your health form is saved by the server.");
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
