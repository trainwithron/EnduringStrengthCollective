import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertReadOnly, buildStateSql, formatReport, summarize } from "../scripts/state-report-lib.mjs";

const probes = JSON.parse(readFileSync("supabase/apply/state-probes.json", "utf8")) as { n: string; slug: string; title: string; notApplied: string | null }[];
const steps = JSON.parse(readFileSync("supabase/apply/steps.json", "utf8")) as { n: string }[];
const bundles = JSON.parse(readFileSync("supabase/apply/bundles.json", "utf8")) as { id: string; name: string; steps: string[]; file: string }[];

describe("the state report", () => {
  it("covers every paste step, and nearly all of them have a check", () => {
    expect(probes.map((p) => p.n).sort()).toEqual(steps.map((s) => s.n).sort());
    expect(probes.filter((p) => p.notApplied).length).toBeGreaterThan(probes.length * 0.9);
  });

  it("builds one plain read that passes its own guard", () => {
    const sql = buildStateSql(probes);
    expect(() => assertReadOnly(sql)).not.toThrow();
    expect(sql.match(/;/g)!.length).toBe(1 + (sql.match(/'[^']*;[^']*'/g) ?? []).length);
  });

  it("refuses anything that is not a single select", () => {
    for (const bad of ["delete from profiles", "select 1; select 2", "select 1; drop table x", "insert into t values (1)", "select 1 from t for update", "update t set a = 1", "with x as (delete from t returning 1) select * from x", "select pg_sleep(1); set role postgres"]) {
      expect(() => assertReadOnly(bad), bad).toThrow();
    }
    expect(() => assertReadOnly("select has_function_privilege('authenticated', 'x()', 'execute') -- comment; drop")).not.toThrow();
  });

  it("groups steps by the bundle that is pasted and says which are waiting", () => {
    const withCheck = probes.filter((p) => p.notApplied);
    const bundle = bundles.find((b) => b.steps.every((n) => withCheck.some((p) => p.n === n)))!;
    const other = bundles.find((b) => b.id !== bundle.id && b.steps.every((n) => withCheck.some((p) => p.n === n)))!;
    const rows = withCheck.map((p) => ({ step: p.n, applied: !bundle.steps.includes(p.n) || false }));
    const summary = summarize(rows, bundles, probes);
    const found = summary.bundles.find((b) => b.id === bundle.id)!;
    expect(found.status).toBe("waiting");
    expect(found.waitingSteps).toEqual(bundle.steps);
    expect(summary.bundles.find((b) => b.id === other.id)!.status).toBe(other.steps.some((n) => bundle.steps.includes(n)) ? "partly" : "applied");
    const text = formatReport(summary);
    expect(text).toContain("WAITING FOR A PASTE");
    expect(text).toContain(`supabase/apply/${bundle.file}`);
  });

  it("says plainly when nothing is waiting, and a half-applied bundle is called out", () => {
    const withCheck = probes.filter((p) => p.notApplied);
    expect(formatReport(summarize(withCheck.map((p) => ({ step: p.n, applied: true })), bundles, probes))).toContain("nothing: every paste is applied");
    const multi = bundles.find((b) => b.steps.length > 1 && b.steps.every((n) => withCheck.some((p) => p.n === n)));
    if (multi) {
      const rows = withCheck.map((p) => ({ step: p.n, applied: p.n !== multi.steps[0] }));
      const found = summarize(rows, bundles, probes).bundles.find((b) => b.id === multi.id)!;
      expect(found.status).toBe("partly");
      expect(formatReport(summarize(rows, bundles, probes))).toContain("PARTLY APPLIED");
    }
  });

  it("the command never writes to the database", () => {
    const cli = readFileSync("scripts/state-report.mjs", "utf8");
    expect(cli).toContain("assertReadOnly(buildStateSql(probes))");
    expect(cli).not.toMatch(/method: "(PUT|PATCH|DELETE)"/);
    expect(cli).toContain("exactly one SELECT");
  });
});
