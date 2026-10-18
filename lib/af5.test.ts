import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("a stuck erase is a failed run, not a quiet success", () => {
  it("the purge job answers 500 when any erase failed (so it is recorded as failed and the administrator is told), and 200 when only blocked ones are left", () => {
    const route = src("app/api/cron/purge-removed-clients/route.ts");
    expect(route).toContain("status: tally.failed > 0 ? 500 : 200");
    // blocked is information only
    expect(route).not.toMatch(/tally\.blocked\s*>/);
  });

  it("withCronRun records any response of 400 or more as a failure", () => {
    expect(src("lib/cron-monitor.ts")).toContain("const ok = response.status < 400 && !ai.problem;");
  });
});

describe("the download carries what the person accepted and when", () => {
  it("reads legal_acceptances through the columns the person may read (not the address and device), in date order, and says nothing false if the read failed", () => {
    const route = src("app/api/account/export/route.ts");
    expect(route).toContain('from("legal_acceptances").select("id, document, version, accepted_at, text_snapshot").eq("profile_id", userId)');
    expect(route).not.toMatch(/legal_acceptances"\)\.select\("\*"\)/);
    expect(route).not.toContain("ip,");
    expect(route).not.toContain("user_agent");
    expect(route).toContain("legalAcceptances: legalError ? null : (legalRows ?? [])");
  });

  it("those columns are exactly the ones granted to a signed-in person", () => {
    const sql = src("supabase/migrations/0399_health_answers_private.sql");
    expect(sql).toContain("grant select (id, profile_id, document, version, accepted_at, text_snapshot) on public.legal_acceptances to authenticated;");
  });
});
