import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertPlainRead, assertReadOnly, buildStateSql, formatReport, summarize } from "../scripts/state-report-lib.mjs";

type Probe = { n: string; slug: string; title: string; notApplied: string[] };
type Bundle = { id: string; name: string; steps: string[]; file: string };
type BundleRow = { id: string; status: string; waitingSteps: string[]; uncheckedSteps: string[] };
const probes = JSON.parse(readFileSync("supabase/apply/state-probes.json", "utf8")) as Probe[];
const steps = JSON.parse(readFileSync("supabase/apply/steps.json", "utf8")) as { n: string }[];
const bundles = JSON.parse(readFileSync("supabase/apply/bundles.json", "utf8")) as Bundle[];
const withChecks = probes.filter((p) => p.notApplied.length > 0);
const answer = (n: string, applied: boolean | null) => probes.find((p) => p.n === n)!.notApplied.map((_, idx) => ({ step: n, idx, applied }));

describe("the state report", () => {
  it("covers every paste step, and nearly all of them have a check", () => {
    expect(probes.map((p) => p.n).sort()).toEqual(steps.map((s) => s.n).sort());
    expect(withChecks.length).toBeGreaterThan(probes.length * 0.9);
  });

  it("builds one plain read from ALL of every step's checks, and it passes its own guard", () => {
    const sql = buildStateSql(probes);
    expect(() => assertReadOnly(sql)).not.toThrow();
    expect(sql.match(/\(\s*'[^']*',\s*\d+,/g)!.length).toBe(probes.reduce((n, p) => n + p.notApplied.length, 0));
    expect(withChecks.some((p) => p.notApplied.length > 1)).toBe(true);
  });

  it("a check the database cannot decide stays unknown: it is not turned into 'waiting'", () => {
    expect(buildStateSql(probes)).not.toMatch(/coalesce\(not \(/);
    expect(buildStateSql(probes)).toContain("(select not e.b from (select (");
  });

  it("refuses everything that is not a plain, single, read-only select (the known ways around a string filter)", () => {
    const bad = [
      "delete from profiles",
      "select 1; select 2",
      "select 1; drop table x",
      "insert into t values (1)",
      "select 1 from t for update",
      "update t set a = 1",
      "with x as (delete from t returning 1) select * from x",
      "select 'a--' ; drop table t; select 'b'",
      "select 1 /* hidden */ ; drop table t",
      "select $$x$$ ; drop table t",
      "select * into newt from t",
      "select pg_terminate_backend(1)",
      "select set_config('a', 'b', false), nextval('s')",
      "select setval('s', 1)",
      "select pg_sleep(1)",
      "select lo_import('/etc/passwd')",
      "select 1 where 1 = (select count(*) from dblink('x', 'drop table t') as t(a int))",
    ];
    for (const sql of bad) expect(() => assertReadOnly(sql), sql).toThrow();
    expect(() => assertReadOnly("select to_regclass('public.x') is null")).not.toThrow();
    // a word inside quotes is only text
    expect(() => assertPlainRead("exists (select 1 from pg_policies where policyname = 'drop table; -- x')".replace("-- x", "x"))).not.toThrow();
  });

  it("a probe that tries to break out is refused when the query is built", () => {
    const evil = [{ n: "99", slug: "x", title: "x", notApplied: ["true); drop table profiles; select (true"] }];
    expect(() => buildStateSql(evil)).toThrow();
    expect(() => buildStateSql([{ ...evil[0], notApplied: ["pg_terminate_backend(1) is null"] }])).toThrow();
  });

  it("groups steps by the bundle that is pasted and says which are waiting", () => {
    const bundle = bundles.find((b) => b.steps.every((n) => withChecks.some((p) => p.n === n)))!;
    const rows = withChecks.flatMap((p) => answer(p.n, !bundle.steps.includes(p.n)));
    const summary = summarize(rows, bundles, probes);
    const found = summary.bundles.find((b: BundleRow) => b.id === bundle.id)!;
    expect(found.status).toBe("waiting");
    expect(found.waitingSteps).toEqual(bundle.steps);
    const text = formatReport(summary);
    expect(text).toContain("WAITING FOR A PASTE");
    expect(text).toContain(`supabase/apply/${bundle.file}`);
  });

  it("says plainly when nothing is waiting", () => {
    const rows = withChecks.flatMap((p) => answer(p.n, true));
    const everyBundleChecked = bundles.filter((b) => b.steps.every((n) => withChecks.some((p) => p.n === n)));
    const text = formatReport(summarize(rows, everyBundleChecked, probes));
    expect(text).toContain("nothing: every paste is applied");
  });

  it("a step with several checks where only some are true reads PARTLY APPLIED, not applied", () => {
    const multi = withChecks.find((p) => p.notApplied.length > 1)!;
    const bundle = bundles.find((b) => b.steps.includes(multi.n) && b.steps.every((n) => withChecks.some((p) => p.n === n)));
    const rows = withChecks.flatMap((p) => p.notApplied.map((_, idx) => ({ step: p.n, idx, applied: p.n === multi.n ? idx === 0 : true })));
    const summary = summarize(rows, bundles, probes);
    if (bundle) {
      const found = summary.bundles.find((b: BundleRow) => b.id === bundle.id)!;
      expect(found.status).toBe("partly");
      expect(found.waitingSteps).toContain(multi.n);
      expect(formatReport(summary)).toContain("PARTLY APPLIED");
    } else {
      expect(summary.loose.find((s: { step: string }) => s.step === multi.n)?.status).toBe("partly");
    }
  });

  it("an unanswered (null) check is unknown, never waiting", () => {
    const bundle = bundles.find((b) => b.steps.length === 1 && withChecks.some((p) => p.n === b.steps[0]))!;
    const rows = withChecks.flatMap((p) => answer(p.n, p.n === bundle.steps[0] ? null : true));
    const found = summarize(rows, bundles, probes).bundles.find((b: BundleRow) => b.id === bundle.id)!;
    expect(found.status).toBe("unknown");
    const waitingLines = formatReport(summarize(rows, bundles, probes)).split("\n").filter((l) => /^\s+(waiting|PARTLY APPLIED)\s/.test(l));
    expect(waitingLines.some((l) => l.includes(`[steps ${bundle.steps[0]}]`) && l.includes(bundle.file))).toBe(false);
  });

  it("one unchecked step does not take a bundle that has waiting steps off the waiting list", () => {
    const bundle = bundles.find((b) => b.steps.length === 2 && withChecks.some((p) => p.n === b.steps[0]) && withChecks.some((p) => p.n === b.steps[1]));
    if (!bundle) return;
    // the first step is answered as not applied; the second has no answer at all
    const rows = withChecks.flatMap((p) => (p.n === bundle.steps[1] ? [] : answer(p.n, p.n === bundle.steps[0] ? false : true)));
    const found = summarize(rows, bundles, probes).bundles.find((b: BundleRow) => b.id === bundle.id)!;
    expect(found.status).toBe("waiting");
    expect(found.waitingSteps).toContain(bundle.steps[0]);
    expect(found.uncheckedSteps).toContain(bundle.steps[1]);
    expect(formatReport(summarize(rows, bundles, probes))).toContain("not checked (no check available)");
    expect(formatReport(summarize(rows, bundles, probes))).toContain("waiting (some not checked)");
  });

  it("the command sends the query only to the read-only endpoint, keeps the token out of tracked files, and never writes to the database", () => {
    const cli = readFileSync("scripts/state-report.mjs", "utf8");
    expect(cli).toContain("/database/query/read-only");
    expect(cli).not.toMatch(/database\/query`/);
    expect(cli).toContain("refuseIfTokenIsTracked(token)");
    expect(cli).toContain("input: token");
    expect(cli).not.toMatch(/"--", token/);
    expect(cli).toContain('git("ls-files", "--error-unmatch", ".env.local")');
    expect(cli).toContain('git("check-ignore", "-q", ".env.local")');
    expect(cli).toContain("buildStateSql(probes)");
    expect(cli).not.toMatch(/method: "(PUT|PATCH|DELETE)"/);
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^\.env\*/m);
  });
});
