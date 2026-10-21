import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const sent = vi.hoisted(() => ({ payloads: [] as { endpoint: string; payload: string }[] }));
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      sent.payloads.push({ endpoint: sub.endpoint, payload });
    },
  },
}));

import { inQuietHours, isQuietNow, pushContent, readPushPrefs, GENERIC_PUSH_BODY } from "./push-prefs";
import { pushBodyFor, STALE_PUSH_HOURS } from "./notification-push";
import { sendPushToProfile } from "./send-push";
import { notifyPaymentReceived } from "./notify-payment";
import { PUSHED_BY_JOB, pushTitleFor } from "./notification-push";

const root = join(__dirname, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
function walk(d: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, d))) {
    if (f === "node_modules" || f === ".next") continue;
    const rel = d + "/" + f;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(rel);
  }
  return out;
}

// A small fake database: tables are arrays; select/eq/maybeSingle/insert as used by the push code.
function fakeDb(tables: Record<string, any[]>, opts: { profileColumnsMissing?: boolean } = {}) {
  const inserted: Record<string, any[]> = {};
  return {
    inserted,
    from(table: string) {
      let rows = tables[table] ?? [];
      let selected = "";
      const q: any = {
        select: (cols: string) => ((selected = cols), q),
        eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
        maybeSingle: async () => {
          if (table === "profiles" && opts.profileColumnsMissing && /quiet_hours|generic_push_text/.test(selected)) return { data: null, error: { message: "column does not exist" } };
          return { data: rows[0] ?? null, error: null };
        },
        insert: async (row: any) => {
          (inserted[table] ??= []).push(row);
          return { error: null };
        },
        delete: () => ({ eq: async () => ({}) }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      return q;
    },
  };
}

beforeEach(() => {
  sent.payloads = [];
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
});

describe("quiet hours", () => {
  it("a window inside one day, one that wraps past midnight, and none", () => {
    expect(inQuietHours(9, 8, 17)).toBe(true);
    expect(inQuietHours(17, 8, 17)).toBe(false); // the end hour itself is awake
    expect(inQuietHours(23, 22, 6)).toBe(true);
    expect(inQuietHours(3, 22, 6)).toBe(true);
    expect(inQuietHours(6, 22, 6)).toBe(false);
    expect(inQuietHours(12, 22, 6)).toBe(false);
    expect(inQuietHours(12, null, null)).toBe(false);
    expect(inQuietHours(12, 5, 5)).toBe(false);
  });
  it("is judged in the person's own time zone", () => {
    const prefs = { quietStart: 22, quietEnd: 6, timeZone: "America/Los_Angeles" };
    expect(isQuietNow(prefs, new Date("2026-10-18T06:00:00Z"))).toBe(true); // 11pm Pacific
    expect(isQuietNow(prefs, new Date("2026-10-18T19:00:00Z"))).toBe(false); // noon Pacific
  });
  it("an unreadable time zone means no quiet hours instead of an error", () => {
    expect(isQuietNow({ quietStart: 22, quietEnd: 6, timeZone: "Not/AZone" }, new Date("2026-10-18T03:00:00Z"))).toBe(false);
  });
  it("private lock screens replace the words and keep nothing of them", () => {
    expect(pushContent({ generic: true }, "New message from Jane", "I hurt my knee")).toEqual({ title: "Spotlight Coaching", body: GENERIC_PUSH_BODY });
    expect(pushContent({ generic: false }, "T", "B")).toEqual({ title: "T", body: "B" });
  });
});

describe("sending a push respects the person", () => {
  const tables = (profile: Record<string, unknown>) => ({
    profiles: [{ id: "p1", timezone: "UTC", ...profile }],
    push_subscriptions: [{ id: "s1", profile_id: "p1", endpoint: "https://push/1", p256dh: "k", auth_key: "a" }],
  });
  const noon = new Date();
  noon.setUTCHours(12, 0, 0, 0);
  const currentHour = new Date().getUTCHours();

  it("sends the real words when nothing is set", async () => {
    const n = await sendPushToProfile(fakeDb(tables({})) as any, "p1", "Hello", "World", "/x");
    expect(n).toBe(1);
    expect(JSON.parse(sent.payloads[0].payload)).toMatchObject({ title: "Hello", body: "World" });
  });
  it("sends nothing during quiet hours, unless it is the platform's own alert", async () => {
    const quiet = tables({ quiet_hours_start: currentHour, quiet_hours_end: (currentHour + 1) % 24 });
    expect(await sendPushToProfile(fakeDb(quiet) as any, "p1", "Hello", "World", "/x")).toBe(0);
    expect(sent.payloads).toHaveLength(0);
    expect(await sendPushToProfile(fakeDb(quiet) as any, "p1", "Down", "The site", "/admin", { ignoreQuiet: true })).toBe(1);
  });
  it("shows only the generic line with a private lock screen", async () => {
    await sendPushToProfile(fakeDb(tables({ generic_push_text: true })) as any, "p1", "New message from Jane", "I hurt my knee", "/x");
    const shown = JSON.parse(sent.payloads[0].payload);
    expect(shown.title).toBe("Spotlight Coaching");
    expect(JSON.stringify(shown)).not.toContain("Jane");
    expect(JSON.stringify(shown)).not.toContain("knee");
  });
  it("a database without the new columns still sends (no quiet hours, real words)", async () => {
    const prefs = await readPushPrefs(fakeDb(tables({}), { profileColumnsMissing: true }) as any, "p1");
    expect(prefs).toMatchObject({ quietStart: null, quietEnd: null, generic: false });
    expect(await sendPushToProfile(fakeDb(tables({}), { profileColumnsMissing: true }) as any, "p1", "Hello", "World", "/x")).toBe(1);
  });
});

describe("a payment tells the coach", () => {
  it("writes one notice and one push for each coach of the group, naming the client and the amount", async () => {
    const db = fakeDb({
      group_memberships: [
        { group_id: "g1", profile_id: "c1", role: "coach" },
        { group_id: "g1", profile_id: "c2", role: "coach" },
        { group_id: "g1", profile_id: "a1", role: "athlete" },
      ],
      profiles: [{ id: "a1", full_name: "Kim Client" }, { id: "c1", timezone: "UTC" }, { id: "c2", timezone: "UTC" }],
      push_subscriptions: [{ id: "s1", profile_id: "c1", endpoint: "https://push/c1", p256dh: "k", auth_key: "a" }],
    });
    const r = await notifyPaymentReceived(db as any, { groupId: "g1", athleteId: "a1", amountCents: 12500, what: "10 sessions" });
    expect(r.coaches).toBe(2);
    expect(db.inserted.notifications).toHaveLength(2);
    expect(db.inserted.notifications[0]).toMatchObject({ type: "payment_received", body: "Kim Client paid $125.00 for 10 sessions." });
    expect(sent.payloads).toHaveLength(1); // only c1 has a phone subscribed
    // the notice in the app has the details; the lock screen does not
    const shown = JSON.stringify(JSON.parse(sent.payloads[0].payload));
    expect(shown).not.toContain("Kim");
    expect(shown).not.toContain("125");
  });
  it("never fails the payment: an error is swallowed", async () => {
    const r = await notifyPaymentReceived({ from: () => { throw new Error("boom"); } } as any, { groupId: "g", athleteId: "a", amountCents: 1, what: "" });
    expect(r.coaches).toBe(0);
  });
});

describe("Release K1: wiring", () => {
  it("the job pushes only notices the database writes, and nothing else pushes those types", () => {
    // every file is read once; code that writes a notice of one of these types itself would be pushed twice
    const files = [...walk("app"), ...walk("lib"), ...walk("components")].filter((f) => f !== "lib/notification-push.ts" && f !== "app/api/cron/notification-push/route.ts");
    const pattern = new RegExp(`type:\\s*["'](${PUSHED_BY_JOB.join("|")})["']`);
    const offenders = files.filter((f) => pattern.test(src(f)));
    expect(offenders).toEqual([]);
    for (const t of PUSHED_BY_JOB) expect(pushTitleFor(t)).not.toBe("New notification");
  });
  it("the job claims a notice before it sends it, ignores old ones, is on the five-minute schedule and is watched", () => {
    const job = src("app/api/cron/notification-push/route.ts");
    expect(job.indexOf(".update({ pushed_at: now })")).toBeLessThan(job.indexOf("sendPushToProfile("));
    expect(job).toContain(".lt(\"created_at\", staleBefore)");
    expect(src("vercel.json")).toContain('"/api/cron/notification-push"');
    expect(src("lib/cron-jobs.ts")).toContain('job: "notification-push"');
  });
  it("the job defers quiet hours, gives back what it did not send, and the phone never shows a name from it", () => {
    const job = src("app/api/cron/notification-push/route.ts");
    expect(job).toContain("isQuietNow(await readPushPrefs(db, profileId))");
    expect(job).toContain("update({ pushed_at: null })");
    expect(job).toContain("run.notStarted");
    expect(job).toContain("pushBodyFor(n.type)");
    expect(job).not.toContain("n.body.slice");
    for (const t of PUSHED_BY_JOB) expect(pushBodyFor(t)).toMatch(/^Open the app/);
    // a notice made at the start of a nine-hour quiet window must still be pushed when it ends
    expect(STALE_PUSH_HOURS).toBeGreaterThanOrEqual(10);
  });
  it("the team announcement pushes only to members whose notice was written", () => {
    expect(src("app/api/org/announce/route.ts")).toContain("runPool(delivered");
  });
  it("invitations, the team announcement and every payment path push; the platform's own alerts ignore quiet hours", () => {
    expect(src("lib/invite-notify.ts")).toContain("sendPushToProfile(");
    expect(src("app/api/org/announce/route.ts")).toContain("sendPushToProfile(");
    const hook = src("app/api/stripe/webhook/route.ts");
    expect((hook.match(/notifyPaymentReceived\(/g) ?? []).length).toBe(3);
    expect(src("lib/cron-monitor.ts")).toContain("ignoreQuiet: true");
    expect(src("app/api/feedback/route.ts")).toContain("ignoreQuiet: true");
  });
  it("the two choices are on the settings page for everyone, saved on the person's own profile", () => {
    // inside the one closed Notifications row (Oct 21), which the settings page shows for everyone
    expect(src("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain("<NotificationSettings");
    expect(src("components/shared/notification-settings.tsx")).toContain("<PushPreferences");
    const ui = src("components/athlete/push-preferences.tsx");
    expect(ui).toContain("quiet_hours_start");
    expect(ui).toContain("generic_push_text");
    expect(ui).toContain(".eq(\"id\", profileId)");
  });
});
