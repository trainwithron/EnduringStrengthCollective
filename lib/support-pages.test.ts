// ORDER FOR RELEASE HP1: the help articles and what's-new entries below are tied to four features (Z1 remove a client, B1 automatic suggestions switch, M1 payment problems, SP1 support notices).
// The test "each article about a feature is there exactly while the feature's own files are" FAILS on any tree where HP1 is merged before all four are in it. So HP1 stays unmerged until
// Z1, B1, M1 and SP1 are all deployed; then rebase it, set the four what's-new dates in lib/changelog.ts to the deploy day, run the suite, and ship.
import { describe, it, expect, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP_ARTICLES, HELP_BY_SLUG, OLD_HELP_SLUGS, SUPPORT_PROMISE, type HelpArticle } from "./help-articles";
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

// Every word an article shows, in order (title, summary, then each section's heading, paragraphs, bullets and closing paragraphs).
const words = (a: HelpArticle) => [a.title, a.summary, ...a.sections.flatMap((s) => [s.heading, ...s.body, ...(s.bullets ?? []).flatMap((b) => [b.lead ?? "", b.text]), ...(s.after ?? [])])].join("\n");
const sectionText = (slug: string, heading: string) => {
  const s = HELP_BY_SLUG.get(slug)?.sections.find((x) => x.heading === heading);
  return s ? [...s.body, ...(s.bullets ?? []).map((b) => (b.lead ?? "") + " " + b.text), ...(s.after ?? [])].join(" ") : "";
};

describe("the help center", () => {
  it("is eleven articles (five for clients, six for coaches), each with a unique short address and headed sections", () => {
    const slugs = (aud: string) => HELP_ARTICLES.filter((a) => a.audience === aud).map((a) => a.slug);
    expect(slugs("client")).toEqual(["getting-started", "log-your-workout", "food", "sessions", "your-account"]);
    expect(slugs("coach")).toEqual(["your-phone", "clients", "programs", "logging-and-sessions", "nutrition", "business"]);
    expect(new Set(HELP_ARTICLES.map((a) => a.slug)).size).toBe(HELP_ARTICLES.length);
    for (const a of HELP_ARTICLES) {
      expect(a.slug, a.slug).toMatch(/^[a-z0-9-]+$/);
      expect(a.summary.length, a.slug).toBeGreaterThan(10);
      expect(a.sections.length, a.slug).toBeGreaterThanOrEqual(3);
      expect(HELP_BY_SLUG.get(a.slug)).toBe(a);
      for (const s of a.sections) {
        // no empty section: a heading always has at least a paragraph or a bullet under it, and nothing in it is blank
        expect(s.body.length + (s.bullets?.length ?? 0), a.slug + ": " + s.heading).toBeGreaterThan(0);
        for (const p of [...s.body, ...(s.after ?? []), ...(s.bullets ?? []).map((b) => b.text)]) expect(p.trim().length, a.slug + ": " + s.heading).toBeGreaterThan(5);
      }
      expect(new Set(a.sections.map((s) => s.heading)).size, a.slug).toBe(a.sections.length);
      // the draft's placeholders are written as [name] / [organization], never in angle brackets ("Settings > Workout Logging" is a menu path)
      expect(words(a), a.slug).not.toMatch(/</);
    }
  });

  it("the two wording changes from the draft are in (demos show for exercises in the Spotlight library)", () => {
    expect(sectionText("programs", "Demo videos")).toMatch(/^An exercise can show a demo\./);
    expect(words(HELP_BY_SLUG.get("programs")!)).not.toContain("Every exercise can show a demo");
    expect(CHANGELOG.some((e) => e.title === "Spotlight demo videos on exercises in the Spotlight library, until you add your own")).toBe(true);
  });

  it("every one of the 21 old addresses goes to the article that now holds its answer", () => {
    expect(OLD_HELP_SLUGS).toEqual({
      "join-with-an-invite": "getting-started",
      "forgot-password": "getting-started",
      "put-the-app-on-your-phone": "getting-started",
      "log-a-workout": "log-your-workout",
      "log-your-food": "food",
      "your-grocery-list": "food",
      "book-and-cancel-sessions": "sessions",
      "turn-notifications-on": "your-account",
      "download-or-delete-my-data": "your-account",
      "add-your-first-client": "clients",
      "message-your-clients": "clients",
      "remove-or-delete-a-client": "clients",
      "build-and-assign-a-program": "programs",
      "sessions-credits-and-bookings": "logging-and-sessions",
      "set-nutrition-targets": "nutrition",
      "see-how-clients-are-eating": "nutrition",
      "pause-automatic-nutrition-suggestions": "nutrition",
      "packages-and-payments": "business",
      "payment-problems": "business",
      "leaving-the-platform": "business",
      "contact-support": "business",
    });
    expect(Object.keys(OLD_HELP_SLUGS)).toHaveLength(21);
    for (const [from, to] of Object.entries(OLD_HELP_SLUGS)) {
      expect(HELP_BY_SLUG.get(to), from + " -> " + to).toBeDefined();
      expect(HELP_BY_SLUG.get(from), from + " is no longer an article").toBeUndefined();
    }
  });

  it("promises nothing it cannot keep: no price, no deadline in hours or days for a reply, no legal term; data answers point at the policies", () => {
    const all = HELP_ARTICLES.map(words).concat(SUPPORT_PROMISE).join("\n");
    expect(all).not.toMatch(/\$\s?\d/);
    expect(all).not.toMatch(/within \d+ (hours?|days?|minutes?)|business days|24\/7|guarantee/i);
    expect(SUPPORT_PROMISE).not.toMatch(/\d/);
    expect(sectionText("your-account", "Delete your account")).toContain("Privacy page");
  });

  it("only describes things that exist: each part about a feature is there exactly while the feature's own files are", () => {
    const live = (p: string) => existsSync(join(__dirname, "..", p));
    const pairs: [boolean, string][] = [
      [sectionText("clients", "Remove, put back, delete").includes("Removed clients"), "components/coach/desktop/removed-clients-panel.tsx"],
      [sectionText("nutrition", "Switches (under Targets > Details)").includes("No automatic suggestions"), "components/coach/nutrition/auto-suggest-off-toggle.tsx"],
      [sectionText("business", "Payment problems").length > 0, "components/coach/payment-problems-section.tsx"],
    ];
    for (const [there, file] of pairs) expect(there, "described if and only if " + file + " is there").toBe(live(file));
    // the support section only says you get a notice once the notices exist
    const notices = live("supabase/migrations/0410_support_reply_notices.sql");
    expect(sectionText("business", "Support").includes("and you get a notice"), "the notice sentence and the notices go together").toBe(notices);
    // and the what's-new entries for these four features go in only with them
    const entries: [string, boolean][] = [
      ["Remove a client without losing them", live(pairs[0][1])],
      ["Pause automatic nutrition suggestions for one client", live(pairs[1][1])],
      ["Payment problems, in one place", live(pairs[2][1])],
      ["A notice when support replies", notices],
    ];
    for (const [title, isLive] of entries) expect(CHANGELOG.some((e) => e.title === title), title + ": in what's new only while the feature is live").toBe(isLive);
  });

  it("there is no parent-view article: a coach can no longer create a parent link (nothing renders the share button), and the help center says nothing about one", () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(__dirname, "..", dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /[.](ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []));
    // keyed on the button being USED (some screen imports it), not on its file existing
    const users = [...walk("app"), ...walk("components")].filter((f) => /GuardianShareButton/.test(readFileSync(join(__dirname, "..", f), "utf8")));
    if (users.length === 0) {
      expect(HELP_BY_SLUG.get("parent-view-link"), "nothing renders the parent-link button, so the help center must not describe it").toBeUndefined();
      expect(HELP_ARTICLES.map(words).join(" ")).not.toMatch(/guardian a private link|A parent.s view/i);
    }
  });

  it("is written in plain words: no internal names (Paste a list is a button)", () => {
    const all = HELP_ARTICLES.map(words).join("\n");
    expect(all).not.toMatch(/migration|paste(?! a list)|RLS|webhook|endpoint|supabase|api\/|cron|step \d/i);
  });
});

describe("the help pages", () => {
  it("an article shows each section's heading, paragraphs and bullets; an old address redirects permanently", () => {
    const page = src("app/help/[slug]/page.tsx");
    expect(page).toContain("if (OLD_HELP_SLUGS[slug]) permanentRedirect(\x60/help/$" + "{OLD_HELP_SLUGS[slug]}\x60);");
    expect(page).toContain("article.sections.map((s) =>");
    expect(page).toContain("<h2");
    expect(page).toContain("{s.bullets && (");
    expect(page).toContain("{b.lead && <strong");
    // the static pages are the new articles only (an old address is answered by the redirect)
    expect(page).toContain("HELP_ARTICLES.map((a) => ({ slug: a.slug }))");
  });

  it("How it works is one tap away: a row on the phone's Spotlight button (above the notifications card) and a button beside Feedback on the computer's rail", () => {
    const hub = src("components/coach/mobile/coach-spot-hub.tsx");
    const row = hub.indexOf('href="/help"');
    expect(row).toBeGreaterThan(hub.indexOf("TILES.filter("));
    expect(row).toBeLessThan(hub.indexOf('<PushNotificationToggle variant="tile"'));
    expect(hub.slice(row, row + 400)).toMatch(/min-h-11[\s\S]*How it works/);
    const shell = src("components/coach/coach-desktop-shell.tsx");
    const feedback = shell.indexOf('<FeedbackButton variant="icon" />');
    const help = shell.indexOf('<Link href="/help" title="How it works" aria-label="How it works"');
    expect(help).toBeGreaterThan(feedback);
    expect(help - feedback).toBeLessThan(80);
  });
});

describe("what's new", () => {
  it("is newest first, dated, and in plain words", () => {
    expect(CHANGELOG.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < CHANGELOG.length; i++) {
      const e = CHANGELOG[i];
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.title.length).toBeGreaterThan(5);
      if (e.body !== undefined) expect(e.body.length).toBeGreaterThan(30);
      expect(e.title + " " + (e.body ?? "")).not.toMatch(/migration|paste|RLS|webhook|supabase|cron|release [a-z]\d|step \d|vitest|</i);
      if (i > 0) expect(CHANGELOG[i - 1].date >= e.date, CHANGELOG[i - 1].title + " before " + e.title).toBe(true);
    }
  });

  it("has the Oct 19 to 26 releases, each on the day it shipped", () => {
    const on = (date: string) => CHANGELOG.filter((e) => e.date === date).map((e) => e.title);
    expect(on("2026-10-26")).toHaveLength(5);
    expect(on("2026-10-24")).toEqual(["A getting-started checklist on a new client's profile"]);
    expect(on("2026-10-21")).toEqual(["Your phone starts in your own organization", "Coach nutrition revamp", "Allergy question asked once"]);
    expect(on("2026-10-20")).toEqual(["Wing it logging", "Logging during a booked time uses that session", "Walk-in prompt", "No-show Charge or Waive", "Faster phone app", "The Spotlight button on the phone", "One calendar that people book on"]);
    expect(on("2026-10-19")).toEqual(["Did-it-happen cards", "A public page with a free consultation, made for you"]);
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
