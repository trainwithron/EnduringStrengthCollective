import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readHealthAnswers, readHealthAnswersMany } from "./health-answers";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    if (name === "node_modules" || name === ".next") continue;
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(rel);
  }
  return out;
}

describe("health answers are read through the database's door", () => {
  it("says which of three things happened: the answers, nothing to read, or a failed read (never 'no concerns')", async () => {
    const answers = [{ question: "Heart condition?", answer: true }];
    expect(await readHealthAnswers({ rpc: async () => ({ data: answers, error: null }) }, "a1")).toEqual({ kind: "ok", answers });
    expect(await readHealthAnswers({ rpc: async () => ({ data: [], error: null }) }, "a1")).toEqual({ kind: "ok", answers: [] });
    expect(await readHealthAnswers({ rpc: async () => ({ data: null, error: null }) }, "a1")).toEqual({ kind: "none" });
    expect(await readHealthAnswers({ rpc: async () => ({ data: null, error: { message: "x" } }) }, "a1")).toEqual({ kind: "error" });
    expect(await readHealthAnswers({ rpc: async () => { throw new Error("network"); } }, "a1")).toEqual({ kind: "error" });
  });

  it("a failed read stops the AI, the export and the assignment check instead of passing as 'no concern'", () => {
    for (const f of ["app/api/ai/build-day/route.ts", "app/api/ai/generate-program/route.ts", "app/api/ai/pick-template/route.ts"]) {
      const code = src(f);
      expect(code, f).toContain('if (parQ.kind === "error") return NextResponse.json({ error: HEALTH_READ_FAILED_MESSAGE }, { status: 503 });');
      // the refusal comes before anything is generated
      expect(code.indexOf('parQ.kind === "error"'), f).toBeLessThan(code.indexOf("callClaude("));
    }
    expect(src("app/api/account/export/route.ts")).toContain('ownAnswers?.kind === "error"');
    expect(src("components/coach/desktop/program-assign-panel.tsx")).toContain("screening.failed");
    expect(src("components/coach/desktop/import-wizard.tsx")).toContain('parQ.kind === "error" ||');
    const page = src("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain('const answersFailed = health.kind === "error";');
    // an owner/admin without access sees the status note and never the "no answers on file" panel
    expect(page.indexOf("answersFailed ? (")).toBeLessThan(page.indexOf("answersHidden ? ("));
    expect(page.indexOf("answersHidden ? (")).toBeLessThan(page.indexOf("<ParQAnswersPanel answers={parQAnswers}"));
  });

  it("access follows the client's current groups, a grant ends with the role, and signed-out visitors hold nothing", () => {
    const sql = src("supabase/migrations/0399_health_answers_private.sql");
    expect(sql).toContain("function public._can_read_health_answers(p_athlete uuid)");
    expect(sql).not.toContain("ci.group_id");
    expect(sql).toContain("after update of role on public.organization_memberships");
    expect(sql).toContain("(old.role = 'owner' and new.role <> 'owner')");
    expect(sql).toContain("revoke all on public.client_intake from anon;");
    expect(sql).toContain("revoke all on public.legal_acceptances from anon;");
    const steps = src("scripts/build-paste-files.mjs");
    expect(steps).toContain("grant delete, insert, references, select, trigger, truncate, update on public.client_intake to anon;");
    expect(steps).not.toContain("step 199");
  });

  it("the batch read gives a list per client, and says when it failed instead of reading it as 'no concerns'", async () => {
    const ok = await readHealthAnswersMany({ rpc: async () => ({ data: [{ athlete_id: "a", par_q_answers: [{ question: "q", answer: false }] }, { athlete_id: "b", par_q_answers: null }], error: null }) }, ["a", "b", "c"]);
    expect(ok.failed).toBe(false);
    expect(ok.answers.get("a")).toHaveLength(1);
    expect(ok.answers.get("b")).toEqual([]);
    expect(ok.answers.has("c")).toBe(false);
    expect((await readHealthAnswersMany({ rpc: async () => ({ data: null, error: { message: "x" } }) }, ["a"])).failed).toBe(true);
  });

  it("no screen or route reads the answers column straight from the table any more", () => {
    // The only places that mention the column: the helper itself, the intake submit (a write by the client themselves) and comments.
    const allowed = new Set(["lib/health-answers.ts", "app/api/intake/submit/route.ts", "lib/athlete-injury-flag.ts", "components/coach/par-q-answers-panel.tsx", "app/api/account/export/route.ts", "app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx"]);
    const offenders = [...walk("app"), ...walk("lib"), ...walk("components")].filter((f) => !allowed.has(f) && src(f).includes("par_q_answers"));
    expect(offenders, "read the answers with readHealthAnswers() / readHealthAnswersMany() (lib/health-answers.ts)").toEqual([]);
    // and nothing asks the table for every column of the intake row (it would be refused now)
    const star = [...walk("app"), ...walk("lib"), ...walk("components")].filter((f) => /from\("client_intake"\)\s*\.select\("\*"\)/.test(src(f)));
    expect(star).toEqual([]);
  });

  it("the owner and the admins of an organization see 'done' or 'needs attention' and nothing more, until the owner grants more", () => {
    const sql = src("supabase/migrations/0399_health_answers_private.sql");
    expect(sql).toContain("revoke select on public.client_intake from authenticated");
    expect(sql).toContain("grant select (athlete_id, group_id, waiver_signed_name, waiver_accepted, completed_at, created_at, updated_at, date_of_birth) on public.client_intake to authenticated");
    expect(sql).not.toMatch(/grant select \([^)]*par_q_answers/);
    expect(sql).toContain("not public.is_client_private_from_org(m.group_id, p_athlete)");
    const page = src("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain('const answersHidden = !!intake && health.kind === "none";');
    expect(src("components/coach/par-q-answers-panel.tsx")).toContain("Needs attention: the form is not finished.");
  });

  it("only the owner grants it, from the Team page, and a grant is per person", () => {
    const panel = src("components/org/team-members-panel.tsx");
    expect(panel).toContain('rpc("set_health_access"');
    expect(panel).toContain("isOwner && (m.role === \"owner\" || m.role === \"admin\")");
    expect(src("supabase/migrations/0399_health_answers_private.sql")).toContain("Only the owner can do that.");
  });

  it("the address and device of an acceptance are read only by the audit path, which leaves a record", () => {
    const sql = src("supabase/migrations/0399_health_answers_private.sql");
    expect(sql).toContain("grant select (id, profile_id, document, version, accepted_at, text_snapshot) on public.legal_acceptances to authenticated");
    expect(sql).toContain("address_and_device_read");
    expect(sql).toContain("grant execute on function public.legal_acceptance_audit(uuid) to service_role");
    expect(sql).not.toMatch(/grant execute on function public\.legal_acceptance_audit\(uuid\) to [^;]*authenticated/);
  });
});
