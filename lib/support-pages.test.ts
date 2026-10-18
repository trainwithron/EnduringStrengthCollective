// ORDER FOR RELEASE HP1: the help articles and what's-new entries below are tied to four features (Z1 remove a client, B1 automatic suggestions switch, M1 payment problems, SP1 support notices).
// The test "each article about a feature is there exactly while the feature's own files are" FAILS on any tree where HP1 is merged before all four are in it. So HP1 stays unmerged until
// Z1, B1, M1 and SP1 are all deployed; then rebase it, set the four what's-new dates in lib/changelog.ts to the deploy day, run the suite, and ship.
import { describe, it, expect, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
import { forgetStatusPageReading, readHealth, readHealthForPage, type HealthReading } from "./health-check";

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

  it("only describes things that exist: each article about a feature is there exactly while the feature's own files are", () => {
    const live = (p: string) => existsSync(join(__dirname, "..", p));
    const pairs: [string, string][] = [
      ["remove-or-delete-a-client", "components/coach/desktop/removed-clients-panel.tsx"],
      ["pause-automatic-nutrition-suggestions", "components/coach/nutrition/auto-suggest-off-toggle.tsx"],
      ["payment-problems", "components/coach/payment-problems-section.tsx"],
    ];
    for (const [slug, file] of pairs) expect(!!HELP_BY_SLUG.get(slug), `${slug} must be there if and only if ${file} is`).toBe(live(file));
    // the support article only says you get a notice once the notices exist
    const notices = live("supabase/migrations/0410_support_reply_notices.sql");
    expect(HELP_BY_SLUG.get("contact-support")!.body.join(" ").includes("You get a notice when we reply"), "the notice sentence and the notices go together").toBe(notices);
    // and the what's-new entries for these four features go in only with them
    const entries: [string, boolean][] = [
      ["Remove a client without losing them", live(pairs[0][1])],
      ["Pause automatic nutrition suggestions for one client", live(pairs[1][1])],
      ["Payment problems, in one place", live(pairs[2][1])],
      ["A notice when support replies", notices],
    ];
    for (const [title, isLive] of entries) expect(CHANGELOG.some((e) => e.title === title), `${title}: in what's new only while the feature is live`).toBe(isLive);
  });

  it("there is no parent-view article: a coach can no longer create a parent link (nothing renders the share button), and the help center says nothing about one", () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(__dirname, "..", dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /[.](ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));
    // keyed on the button being USED (some screen imports it), not on its file existing
    const users = [...walk("app"), ...walk("components")].filter((f) => /GuardianShareButton/.test(readFileSync(join(__dirname, "..", f), "utf8")));
    if (users.length === 0) {
      expect(HELP_BY_SLUG.get("parent-view-link"), "nothing renders the parent-link button, so the help center must not describe it").toBeUndefined();
      expect(HELP_ARTICLES.flatMap((a) => [a.title, a.summary, ...a.body]).join(" ")).not.toMatch(/guardian a private link|A parent.s view/i);
    }
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

describe("the status page's own reading", () => {
  const ok: HealthReading = { httpStatus: 200, status: "ok", body: { status: "ok", database: "reachable", timestamp: "2026-10-18T00:00:00Z" } };

  it("is remembered for 30 seconds, then read again; the monitor's reading is never remembered", async () => {
    forgetStatusPageReading();
    let calls = 0;
    const read = async () => (calls++, ok);
    let t = 1_000_000;
    await readHealthForPage({ read, now: () => t });
    await readHealthForPage({ read, now: () => t + 29_000 });
    expect(calls).toBe(1);
    await readHealthForPage({ read, now: () => t + 31_000 });
    expect(calls).toBe(2);
    t += 100_000;
    forgetStatusPageReading();
  });

  it("a good reading is remembered 30 seconds but a bad one only 5, so a recovered database stops looking troubled almost at once", async () => {
    forgetStatusPageReading();
    const bad: HealthReading = { httpStatus: 503, status: "error", body: { status: "error", database: "unreachable", timestamp: "2026-10-18T00:00:00Z" } };
    let calls = 0;
    const read = async () => (calls++ === 0 ? bad : ok);
    const t = 5_000_000;
    expect((await readHealthForPage({ read, now: () => t })).status).toBe("error");
    expect((await readHealthForPage({ read, now: () => t + 4_000 })).status).toBe("error");
    expect(calls).toBe(1);
    expect((await readHealthForPage({ read, now: () => t + 6_000 })).status).toBe("ok");
    expect(calls).toBe(2);
    await readHealthForPage({ read, now: () => t + 20_000 });
    expect(calls).toBe(2);
    forgetStatusPageReading();
  });

  it("gives up after a short wait and says we are having trouble, instead of hanging", async () => {
    forgetStatusPageReading();
    const never = () => new Promise<HealthReading>(() => undefined);
    const r = await readHealthForPage({ read: never, timeoutMs: 20, ttlMs: 0 });
    expect(r).toMatchObject({ status: "error", httpStatus: 503 });
    forgetStatusPageReading();
  });

  it("the page tells 'not checked yet' apart from 'working' for the background work, and does not claim everything is working then", () => {
    const page = src("app/status/page.tsx");
    expect(page).toContain("Not being checked yet.");
    expect(page).toContain('body.jobs?.status === "ok"');
    expect(page).toContain("The app and your data are working");
    expect(page).toContain("readHealthForPage()");
    expect(src("app/api/health/route.ts")).toContain("readHealth()");
    expect(src("app/api/health/route.ts")).not.toContain("readHealthForPage");
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
    expect(src("app/status/page.tsx")).toContain('dynamic = "force-dynamic"');
    expect(src("app/help/[slug]/page.tsx")).toContain("generateStaticParams");
    expect(src("components/support/help-shell.tsx")).toContain("SUPPORT_PROMISE");
  });

  it("the status page shows job names and details to no one", () => {
    const page = src("app/status/page.tsx");
    expect(page).not.toMatch(/stale|\.job\b|reason/);
  });
});
