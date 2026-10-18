import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP_ARTICLES, HELP_AUDIENCES, HELP_BY_SLUG, SUPPORT_PROMISE } from "./help-articles";
import { CHANGELOG } from "./changelog";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// A stand-in service client for the health reading.
const db = vi.hoisted(() => ({ profilesError: null as unknown, cronRows: [] as unknown[], cronError: null as unknown, throwOnProfiles: false }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      return {
        select: () => {
          if (table === "profiles") {
            if (db.throwOnProfiles) throw new Error("down");
            return { limit: async () => ({ error: db.profilesError }) };
          }
          return Promise.resolve({ data: db.cronRows, error: db.cronError });
        },
      };
    },
  }),
}));
import { readHealth } from "./health-check";

describe("the help center", () => {
  it("has about twenty articles for both audiences, each with a unique address and real text", () => {
    expect(HELP_ARTICLES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(HELP_ARTICLES.map((a) => a.slug)).size).toBe(HELP_ARTICLES.length);
    for (const aud of HELP_AUDIENCES) expect(HELP_ARTICLES.filter((a) => a.audience === aud.key).length, aud.key).toBeGreaterThanOrEqual(5);
    for (const a of HELP_ARTICLES) {
      expect(a.slug, a.slug).toMatch(/^[a-z0-9-]+$/);
      expect(a.title.length, a.slug).toBeGreaterThan(5);
      expect(a.summary.length, a.slug).toBeGreaterThan(10);
      expect(a.body.length, a.slug).toBeGreaterThanOrEqual(2);
      for (const p of a.body) expect(p.length, a.slug).toBeGreaterThan(20);
      expect(HELP_BY_SLUG.get(a.slug)).toBe(a);
    }
  });

  it("promises nothing it cannot keep: no price, no deadline in hours or days for a reply, no legal term; money and data answers point at the policies", () => {
    const all = HELP_ARTICLES.flatMap((a) => [a.title, a.summary, ...a.body]).concat(SUPPORT_PROMISE).join("\n");
    expect(all).not.toMatch(/\$\s?\d/);
    expect(all).not.toMatch(/within \d+ (hours?|days?|minutes?)|business days|24\/7|guarantee/i);
    expect(SUPPORT_PROMISE).not.toMatch(/\d/);
    expect(HELP_BY_SLUG.get("download-or-delete-my-data")!.body.join(" ")).toContain("Privacy page");
  });

  it("only describes things that exist: nothing about a feature that is not live yet", () => {
    const all = HELP_ARTICLES.flatMap((a) => a.body).join("\n");
    // These ship in later releases; their articles are added with them.
    expect(all).not.toMatch(/Removed clients|No automatic suggestions|Payment problems?|refund does not take sessions/);
  });

  it("is written in plain words: no internal names", () => {
    const all = HELP_ARTICLES.flatMap((a) => [a.title, a.summary, ...a.body]).join("\n");
    expect(all).not.toMatch(/migration|paste|RLS|webhook|endpoint|supabase|api\/|cron|step \d/i);
  });
});

describe("what's new", () => {
  it("is newest first, dated, and in plain words", () => {
    expect(CHANGELOG.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < CHANGELOG.length; i++) {
      const e = CHANGELOG[i];
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title.length).toBeGreaterThan(5);
      expect(e.body.length).toBeGreaterThan(30);
      expect(`${e.title} ${e.body}`).not.toMatch(/migration|paste|RLS|webhook|supabase|cron|release [a-z]\d|step \d|vitest/i);
      if (i > 0) expect(CHANGELOG[i - 1].date >= e.date, `${CHANGELOG[i - 1].title} before ${e.title}`).toBe(true);
    }
  });
});

describe("the status page reads the same health as the monitor", () => {
  it("ok when the database answers and no job is late, 200", async () => {
    db.profilesError = null;
    db.cronRows = [];
    const r = await readHealth();
    expect(r.httpStatus).toBe(200);
    expect(r.status).toBe("ok");
    expect(r.body).toMatchObject({ status: "ok", database: "reachable" });
  });

  it("error and 503 when the database does not answer (a refused answer or a thrown one), with nothing else said", async () => {
    db.profilesError = { message: "refused" };
    const refused = await readHealth();
    expect(refused).toMatchObject({ httpStatus: 503, status: "error" });
    expect(refused.body).toMatchObject({ status: "error", database: "unreachable" });
    expect(Object.keys(refused.body).sort()).toEqual(["database", "status", "timestamp"]);
    db.profilesError = null;
    db.throwOnProfiles = true;
    expect((await readHealth()).httpStatus).toBe(503);
    db.throwOnProfiles = false;
  });
});

describe("how it is wired", () => {
  it("the pages are public, linked from the sign-in row and from Settings, and the health route and the status page share one reading", () => {
    const mw = src("lib/supabase/middleware.ts");
    for (const p of ['pathname === "/help"', 'pathname.startsWith("/help/")', 'pathname === "/changelog"', 'pathname === "/status"']) expect(mw).toContain(p);
    expect(src("components/legal/legal-links.tsx")).toContain('href="/help"');
    expect(src("components/legal/legal-links.tsx")).toContain('href="/status"');
    expect(src("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain('href="/help"');
    expect(src("app/api/health/route.ts")).toContain("readHealth()");
    expect(src("app/status/page.tsx")).toContain("readHealth()");
    expect(src("app/status/page.tsx")).toContain('dynamic = "force-dynamic"');
    expect(src("app/help/[slug]/page.tsx")).toContain("generateStaticParams");
    expect(src("components/support/help-shell.tsx")).toContain("SUPPORT_PROMISE");
  });

  it("the status page shows job names and details to no one", () => {
    const page = src("app/status/page.tsx");
    expect(page).not.toMatch(/stale|\.job\b|reason/);
  });
});
