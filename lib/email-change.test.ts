import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[], configured: true }));
vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => mail.configured,
  sendEmail: async (to: string, subject: string, text: string) => (mail.sent.push({ to, subject, text }), true),
}));

import { cancelEmailChange, confirmEmailChange, describeEmailChange, EMAIL_CHANGE_HOURS, requestEmailChange, sendEmailChangeMessages } from "./email-change";
import { hashClaimToken } from "./client-claim";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

interface Row {
  id: string;
  profile_id: string;
  new_email: string;
  old_email: string | null;
  token_hash: string;
  group_id: string | null;
  expires_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
}

// A tiny stand-in: the waiting-requests table, the notifications table and the auth admin.
function fakeDb(opts: { updateError?: string } = {}) {
  const rows: Row[] = [];
  const notes: { type: string; profile_id: string }[] = [];
  const authUpdates: { id: string; email: string; email_confirm: boolean }[] = [];
  let seq = 0;
  const db = {
    rows,
    notes,
    authUpdates,
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: { email: string; email_confirm: boolean }) => {
          if (opts.updateError) return { error: { message: opts.updateError } };
          authUpdates.push({ id, ...attrs });
          return { error: null };
        },
      },
    },
    from(table: string) {
      if (table === "notifications") return { insert: async (row: { type: string; profile_id: string }) => (notes.push(row), { error: null }) };
      // pending_email_changes
      const match: ((r: Row) => boolean)[] = [];
      const q: any = {
        _patch: null as Partial<Row> | null,
        insert: (row: Partial<Row>) => {
          const made = { id: "r" + seq++, confirmed_at: null, cancelled_at: null, old_email: null, group_id: null, ...row } as Row;
          rows.push(made);
          return { select: () => ({ single: async () => ({ data: { id: made.id }, error: null }) }) };
        },
        select: () => q,
        update: (patch: Partial<Row>) => ((q._patch = patch), q),
        eq: (c: keyof Row, v: unknown) => (match.push((r) => r[c] === v), q),
        neq: (c: keyof Row, v: unknown) => (match.push((r) => r[c] !== v), q),
        is: (c: keyof Row, v: unknown) => (match.push((r) => (r[c] ?? null) === v), q),
        gt: (c: keyof Row, v: string) => (match.push((r) => String(r[c]) > v), q),
        maybeSingle: async () => ({ data: rows.find((r) => match.every((m) => m(r))) ?? null }),
        then: (resolve: (v: unknown) => unknown) => {
          const hit = rows.filter((r) => match.every((m) => m(r)));
          if (q._patch) for (const r of hit) Object.assign(r, q._patch);
          resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
        },
      };
      return q;
    },
  };
  return db;
}

beforeEach(() => {
  mail.sent = [];
  mail.configured = true;
});

const tokenFrom = (link: string) => new URL(link).searchParams.get("token")!;

describe("a sign-in email change waits for the new address", () => {
  it("asking for a change records a request and touches nothing about the account", async () => {
    const db = fakeDb();
    const r = await requestEmailChange(db, { profileId: "p1", newEmail: "New@Example.com", oldEmail: "old@example.com", requestedBy: "coach", groupId: "g1", origin: "https://app.test" });
    expect(r.ok).toBe(true);
    expect(db.authUpdates).toEqual([]);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].new_email).toBe("new@example.com");
    // only the hash of the token is stored
    const token = tokenFrom((r as any).confirmLink);
    expect(db.rows[0].token_hash).toBe(hashClaimToken(token));
    expect(JSON.stringify(db.rows)).not.toContain(token);
    expect(new Date(db.rows[0].expires_at).getTime() - Date.now()).toBeLessThanOrEqual(EMAIL_CHANGE_HOURS * 3600_000);
  });

  it("a newer request for the same person replaces the older one", async () => {
    const db = fakeDb();
    const first = (await requestEmailChange(db, { profileId: "p1", newEmail: "a@example.com", oldEmail: null, requestedBy: "c", groupId: null, origin: "https://app.test" })) as any;
    await requestEmailChange(db, { profileId: "p1", newEmail: "b@example.com", oldEmail: null, requestedBy: "c", groupId: null, origin: "https://app.test" });
    const old = await confirmEmailChange(db, tokenFrom(first.confirmLink));
    expect(old).toEqual({ ok: false, reason: "cancelled" });
  });

  it("only pressing Confirm changes the login, once, and tells the client and the old address", async () => {
    const db = fakeDb();
    const r = (await requestEmailChange(db, { profileId: "p1", newEmail: "new@example.com", oldEmail: "old@example.com", requestedBy: "c", groupId: "g1", origin: "https://app.test" })) as any;
    const token = tokenFrom(r.confirmLink);
    // describing the link (what opening it does) changes nothing
    expect(await describeEmailChange(db, token)).toMatchObject({ state: "waiting" });
    expect(db.authUpdates).toEqual([]);
    const done = await confirmEmailChange(db, token);
    expect(done).toEqual({ ok: true, email: "new@example.com", profileId: "p1" });
    expect(db.authUpdates).toEqual([{ id: "p1", email: "new@example.com", email_confirm: true }]);
    // the client's notice (which also starts the 24-hour pause on sending sign-in links to a new inbox) and the old address's email
    expect(db.notes.map((n) => n.type)).toEqual(["email_changed"]);
    expect(mail.sent.map((m) => m.to)).toEqual(["old@example.com"]);
    // a second press does nothing
    expect(await confirmEmailChange(db, token)).toEqual({ ok: false, reason: "used" });
    expect(db.authUpdates).toHaveLength(1);
  });

  it("a link past its 48 hours, a cancelled one and an unknown one change nothing", async () => {
    const db = fakeDb();
    const r = (await requestEmailChange(db, { profileId: "p1", newEmail: "n@example.com", oldEmail: null, requestedBy: "c", groupId: null, origin: "https://app.test" })) as any;
    const token = tokenFrom(r.confirmLink);
    db.rows[0].expires_at = new Date(Date.now() - 1000).toISOString();
    expect(await confirmEmailChange(db, token)).toEqual({ ok: false, reason: "expired" });
    expect(await confirmEmailChange(db, "nope")).toEqual({ ok: false, reason: "invalid" });
    const second = (await requestEmailChange(db, { profileId: "p2", newEmail: "m@example.com", oldEmail: null, requestedBy: "c", groupId: null, origin: "https://app.test" })) as any;
    const t2 = tokenFrom(second.cancelLink);
    expect((await cancelEmailChange(db, t2)).ok).toBe(true);
    expect(await confirmEmailChange(db, t2)).toEqual({ ok: false, reason: "cancelled" });
    expect(db.authUpdates).toEqual([]);
    expect(db.notes.map((n) => n.type)).toEqual(["email_change_cancelled"]);
  });

  it("an address someone else has by the time it is confirmed leaves the request open and says so", async () => {
    const db = fakeDb({ updateError: "User already registered" });
    const r = (await requestEmailChange(db, { profileId: "p1", newEmail: "n@example.com", oldEmail: null, requestedBy: "c", groupId: null, origin: "https://app.test" })) as any;
    expect(await confirmEmailChange(db, tokenFrom(r.confirmLink))).toEqual({ ok: false, reason: "taken" });
    expect(db.rows[0].confirmed_at).toBeNull();
  });

  it("both addresses are written to: the new one gets the confirm link, the old one the cancel link and a masked address", async () => {
    const sent = await sendEmailChangeMessages({ coachName: "Coach Ron", newEmail: "new@example.com", oldEmail: "old@example.com", confirmLink: "https://app.test/email-change?action=confirm&token=t", cancelLink: "https://app.test/email-change?action=cancel&token=t" });
    expect(sent).toEqual({ toNew: true, toOld: true });
    const toNew = mail.sent.find((m) => m.to === "new@example.com")!;
    const toOld = mail.sent.find((m) => m.to === "old@example.com")!;
    expect(toNew.text).toContain("action=confirm");
    expect(toNew.text).not.toContain("action=cancel");
    expect(toOld.text).toContain("action=cancel");
    expect(toOld.text).not.toContain("new@example.com");
  });
});

describe("wiring", () => {
  it("the coach's correction never changes the login itself", () => {
    const route = src("app/api/clients/correct-email/route.ts");
    expect(route).not.toContain("updateUserById");
    expect(route).toContain("requestEmailChange(");
    expect(route).toContain("sendEmailChangeMessages(");
    // the confirmation must have been sent before anything is promised
    expect(route.indexOf("sendEmailChangeMessages(")).toBeLessThan(route.indexOf("email_change_requested"));
  });
  it("opening the link changes nothing: the page only describes it and the change is a button press (POST)", () => {
    const page = src("app/email-change/page.tsx");
    expect(page).toContain("describeEmailChange(");
    expect(page).not.toContain("confirmEmailChange(");
    expect(src("components/auth/email-change-buttons.tsx")).toContain('method: "POST"');
    expect(src("app/api/email-change/confirm/route.ts")).toContain("export async function POST");
    expect(src("app/api/email-change/confirm/route.ts")).not.toContain("export async function GET");
  });
  it("the link works with no session (any device), and is rate limited", () => {
    const mw = src("lib/supabase/middleware.ts");
    expect(mw).toContain('pathname.startsWith("/email-change")');
    expect(mw).toContain('pathname.startsWith("/api/email-change/")');
    expect(src("app/api/email-change/confirm/route.ts")).toContain("rateLimitResponse(");
    expect(src("app/api/email-change/cancel/route.ts")).toContain("rateLimitResponse(");
  });
  it("before the client has signed in, correcting the address cancels the link sent to the old one", () => {
    const route = src("app/api/clients/fix-email/route.ts");
    expect(route).toContain('.from("client_invites").update({ used_at: retiredAt');
  });
  it("it never gets in the way of resending an invite: a waiting change leaves the login alone and the 24-hour pause starts only when a change is confirmed", () => {
    const resend = src("lib/resend-access.ts");
    expect(resend).toContain('"email_changed"');
    const emailChange = src("lib/email-change.ts");
    // 'email_changed' is written only on confirmation, never when a change is merely asked for
    expect(emailChange.match(/type: "email_changed"/g)?.length).toBe(1);
    expect(emailChange.indexOf('type: "email_changed"')).toBeGreaterThan(emailChange.indexOf("export async function confirmEmailChange"));
    expect(src("app/api/clients/correct-email/route.ts")).not.toContain('"email_changed"');
  });
});
