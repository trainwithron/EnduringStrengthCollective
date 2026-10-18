import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[], configured: true }));
vi.mock("@/lib/email", () => ({
  isEmailConfigured: () => mail.configured,
  sendEmail: async (to: string, subject: string, text: string) => (mail.sent.push({ to, subject, text }), true),
}));

import {
  abandonRequest,
  cancelEmailChange,
  cancelPendingForProfile,
  confirmEmailChange,
  describeEmailChange,
  EMAIL_CHANGE_DELAY_HOURS,
  EMAIL_CHANGE_HOURS,
  pendingForProfile,
  requestEmailChange,
  sendEmailChangeMessages,
  supersedeOlder,
} from "./email-change";
import { hashClaimToken } from "./client-claim";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const H = 3600_000;

interface Row {
  id: string;
  profile_id: string;
  new_email: string;
  old_email: string | null;
  token_hash: string;
  cancel_token_hash: string;
  group_id: string | null;
  requested_by: string | null;
  confirmable_at: string;
  expires_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

// A tiny stand-in: the waiting-requests table, the notifications table, the coach's seat and the auth admin.
function fakeDb(opts: { updateError?: string; currentEmail?: string | null; coach?: boolean } = {}) {
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
        getUserById: async () => ({ data: { user: { email: opts.currentEmail === undefined ? "old@example.com" : opts.currentEmail } } }),
        updateUserById: async (id: string, attrs: { email: string; email_confirm: boolean }) => {
          if (opts.updateError) return { error: { message: opts.updateError } };
          authUpdates.push({ id, ...attrs });
          return { error: null };
        },
      },
    },
    from(table: string) {
      if (table === "notifications") return { insert: async (row: { type: string; profile_id: string }) => (notes.push(row), { error: null }) };
      if (table === "group_memberships") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: opts.coach === false ? "athlete" : "coach" } }) }) }) }) };
      // pending_email_changes
      const match: ((r: Row) => boolean)[] = [];
      const q: any = {
        _patch: null as Partial<Row> | null,
        insert: (row: Partial<Row>) => {
          const made = { id: "r" + seq++, confirmed_at: null, cancelled_at: null, old_email: null, group_id: null, requested_by: null, created_at: new Date(Date.now() + seq).toISOString(), ...row } as Row;
          rows.push(made);
          return { select: () => ({ single: async () => ({ data: { id: made.id }, error: null }) }) };
        },
        select: () => q,
        update: (patch: Partial<Row>) => ((q._patch = patch), q),
        eq: (c: keyof Row, v: unknown) => (match.push((r) => r[c] === v), q),
        neq: (c: keyof Row, v: unknown) => (match.push((r) => r[c] !== v), q),
        is: (c: keyof Row, v: unknown) => (match.push((r) => (r[c] ?? null) === v), q),
        gt: (c: keyof Row, v: string) => (match.push((r) => String(r[c]) > v), q),
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows.find((r) => match.every((m) => m(r))) ?? null }),
        then: (resolve: (v: unknown) => unknown) => {
          const hit = rows.filter((r) => match.every((m) => m(r)));
          if (q._patch) for (const r of hit) Object.assign(r, q._patch);
          resolve({ data: hit.map((r) => ({ ...r })), error: null });
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
const ask = (db: ReturnType<typeof fakeDb>, over: Partial<Parameters<typeof requestEmailChange>[1]> = {}) =>
  requestEmailChange(db, { profileId: "p1", newEmail: "new@example.com", oldEmail: "old@example.com", requestedBy: "coach", groupId: "g1", origin: "https://app.test", hasSignedIn: false, ...over }) as Promise<any>;
const later = (hours: number) => new Date(Date.now() + hours * H);

describe("a sign-in email change waits for the new address", () => {
  it("asking for a change records a request and touches nothing about the account", async () => {
    const db = fakeDb();
    const r = await ask(db, { newEmail: "New@Example.com" });
    expect(r.ok).toBe(true);
    expect(db.authUpdates).toEqual([]);
    expect(db.rows[0].new_email).toBe("new@example.com");
    // only the hashes of the two tokens are stored, and they are different tokens
    const confirmToken = tokenFrom(r.confirmLink);
    const cancelToken = tokenFrom(r.cancelLink);
    expect(confirmToken).not.toBe(cancelToken);
    expect(db.rows[0].token_hash).toBe(hashClaimToken(confirmToken));
    expect(db.rows[0].cancel_token_hash).toBe(hashClaimToken(cancelToken));
    expect(JSON.stringify(db.rows)).not.toContain(confirmToken);
  });

  it("the old address's cancel link can never confirm, and the new address's confirm link can never cancel", async () => {
    const db = fakeDb();
    const r = await ask(db);
    const confirmToken = tokenFrom(r.confirmLink);
    const cancelToken = tokenFrom(r.cancelLink);
    expect(await confirmEmailChange(db, cancelToken)).toEqual({ ok: false, reason: "invalid" });
    expect((await cancelEmailChange(db, confirmToken)).ok).toBe(false);
    expect(db.authUpdates).toEqual([]);
    expect(db.rows[0].cancelled_at).toBeNull();
    expect(await describeEmailChange(db, cancelToken, "confirm")).toEqual({ state: "unknown" });
    // each works for its own job
    expect((await cancelEmailChange(db, cancelToken)).ok).toBe(true);
    expect(db.rows[0].cancelled_at).not.toBeNull();
  });

  it("a signed-in account with a real old email cannot confirm for a day; one with no real old email can at once", async () => {
    const db = fakeDb();
    const signedIn = await ask(db, { hasSignedIn: true });
    expect(new Date(signedIn.confirmableAt).getTime() - Date.now()).toBeGreaterThan((EMAIL_CHANGE_DELAY_HOURS - 1) * H);
    const t = tokenFrom(signedIn.confirmLink);
    expect(await confirmEmailChange(db, t)).toMatchObject({ ok: false, reason: "too_soon" });
    expect(await describeEmailChange(db, t, "confirm")).toMatchObject({ state: "waiting", hoursUntilConfirmable: expect.any(Number) });
    expect(db.authUpdates).toEqual([]);
    // a day later it works (and stays open for EMAIL_CHANGE_HOURS after that)
    expect(await confirmEmailChange(db, t, later(EMAIL_CHANGE_DELAY_HOURS + 1))).toMatchObject({ ok: true });
    const placeholder = await ask(fakeDb(), { profileId: "p2", oldEmail: "client-1@pending.invalid", hasSignedIn: true });
    expect(new Date(placeholder.confirmableAt).getTime() - Date.now()).toBeLessThan(5000);
  });

  it("a request is open for EMAIL_CHANGE_HOURS after the first moment it can be confirmed, and then expires", async () => {
    const db = fakeDb();
    const r = await ask(db, { hasSignedIn: true });
    const t = tokenFrom(r.confirmLink);
    expect(await confirmEmailChange(db, t, later(EMAIL_CHANGE_DELAY_HOURS + EMAIL_CHANGE_HOURS + 1))).toEqual({ ok: false, reason: "expired" });
    expect(db.authUpdates).toEqual([]);
  });

  it("only pressing Confirm changes the login, once, and tells the client and the old address", async () => {
    const db = fakeDb();
    const r = await ask(db);
    const token = tokenFrom(r.confirmLink);
    expect(await describeEmailChange(db, token)).toMatchObject({ state: "waiting" });
    expect(db.authUpdates).toEqual([]);
    expect(await confirmEmailChange(db, token)).toEqual({ ok: true, email: "new@example.com", profileId: "p1" });
    expect(db.authUpdates).toEqual([{ id: "p1", email: "new@example.com", email_confirm: true }]);
    expect(db.notes.map((n) => n.type)).toEqual(["email_changed"]);
    expect(mail.sent.map((m) => m.to)).toEqual(["old@example.com"]);
    expect(await confirmEmailChange(db, token)).toEqual({ ok: false, reason: "used" });
    expect(db.authUpdates).toHaveLength(1);
  });

  it("refuses (and closes the request) when the situation has changed since it was asked for", async () => {
    // the login is no longer the address it was
    const moved = fakeDb({ currentEmail: "someone-else@example.com" });
    const a = await ask(moved);
    expect(await confirmEmailChange(moved, tokenFrom(a.confirmLink))).toEqual({ ok: false, reason: "stale" });
    expect(moved.authUpdates).toEqual([]);
    expect(moved.rows[0].cancelled_at).not.toBeNull();
    // the coach no longer coaches the client
    const noSeat = fakeDb({ coach: false });
    const b = await ask(noSeat);
    expect(await confirmEmailChange(noSeat, tokenFrom(b.confirmLink))).toEqual({ ok: false, reason: "stale" });
    expect(noSeat.authUpdates).toEqual([]);
    // a newer request is waiting
    const newer = fakeDb();
    const first = await ask(newer);
    await ask(newer, { newEmail: "other@example.com" });
    expect(await confirmEmailChange(newer, tokenFrom(first.confirmLink))).toEqual({ ok: false, reason: "stale" });
    // the older request is not closed by that: it stays open (so it is still valid if the newer email never arrives)
    expect(newer.rows[0].cancelled_at).toBeNull();
    expect(newer.rows[0].confirmed_at).toBeNull();
  });

  it("an address someone else has by then leaves the request open and says so", async () => {
    const db = fakeDb({ updateError: "User already registered" });
    const r = await ask(db);
    expect(await confirmEmailChange(db, tokenFrom(r.confirmLink))).toEqual({ ok: false, reason: "taken" });
    expect(db.rows[0].confirmed_at).toBeNull();
  });

  it("a cancel that comes after a confirm says it could not cancel, and writes no notice", async () => {
    const db = fakeDb();
    const r = await ask(db);
    await confirmEmailChange(db, tokenFrom(r.confirmLink));
    db.notes.length = 0;
    expect((await cancelEmailChange(db, tokenFrom(r.cancelLink))).ok).toBe(false);
    expect(db.notes).toEqual([]);
  });

  it("an expired request cannot be cancelled and writes no notice", async () => {
    const db = fakeDb();
    const r = await ask(db);
    expect((await cancelEmailChange(db, tokenFrom(r.cancelLink), later(EMAIL_CHANGE_HOURS + 1))).ok).toBe(false);
    expect(db.notes).toEqual([]);
  });

  it("an earlier request is replaced only after the new one's email went out; a failed one is closed", async () => {
    const db = fakeDb();
    const first = await ask(db);
    const second = await ask(db, { newEmail: "second@example.com" });
    // nothing was cancelled yet (the send has not happened)
    expect(db.rows.map((r) => r.cancelled_at)).toEqual([null, null]);
    await supersedeOlder(db, "p1", second.id);
    expect(db.rows[0].cancelled_at).not.toBeNull();
    expect(db.rows[1].cancelled_at).toBeNull();
    const third = await ask(db, { newEmail: "third@example.com" });
    await abandonRequest(db, third.id);
    expect(db.rows[2].cancelled_at).not.toBeNull();
    expect(db.rows[1].cancelled_at).toBeNull(); // the earlier waiting one is untouched by a failed send
    void first;
  });

  it("the signed-in person sees their own waiting change and can cancel it without any link", async () => {
    const db = fakeDb();
    await ask(db);
    expect(await pendingForProfile(db, "p1")).toEqual({ newEmail: expect.stringContaining("@") });
    expect(await cancelPendingForProfile(db, "p1")).toEqual({ ok: true, cancelled: 1 });
    expect(await pendingForProfile(db, "p1")).toBeNull();
    expect(db.notes.map((n) => n.type)).toEqual(["email_change_cancelled"]);
  });

  it("both addresses are written to: the new one gets only the confirm link, the old one only the cancel link and a masked address", async () => {
    const sent = await sendEmailChangeMessages({ coachName: "Coach Ron", newEmail: "new@example.com", oldEmail: "old@example.com", confirmLink: "https://app.test/email-change?action=confirm&token=A", cancelLink: "https://app.test/email-change?action=cancel&token=B", confirmableAt: later(24).toISOString() });
    expect(sent).toEqual({ toNew: true, toOld: true });
    const toNew = mail.sent.find((m) => m.to === "new@example.com")!;
    const toOld = mail.sent.find((m) => m.to === "old@example.com")!;
    expect(toNew.text).toContain("token=A");
    expect(toNew.text).not.toContain("token=B");
    expect(toOld.text).toContain("token=B");
    expect(toOld.text).not.toContain("token=A");
    expect(toOld.text).not.toContain("new@example.com");
  });
});

describe("wiring", () => {
  it("the client's notice says \"not before tomorrow\" only when there is a wait, and the banner is on the notifications page too", () => {
    const route = src("app/api/clients/correct-email/route.ts");
    expect(route).toContain("new Date(asked.confirmableAt).getTime() - Date.now() > 3600_000");
    expect(src("app/notifications/page.tsx")).toContain("<PendingEmailChangeBanner userId={user.id} />");
  });
  it("the coach's correction never changes the login itself, and only supersedes after the email went out", () => {
    const route = src("app/api/clients/correct-email/route.ts");
    expect(route).not.toContain("updateUserById");
    expect(route).toContain("requestEmailChange(");
    expect(route.indexOf("sendEmailChangeMessages(")).toBeLessThan(route.indexOf("supersedeOlder("));
    expect(route.indexOf("abandonRequest(")).toBeGreaterThan(route.indexOf("sendEmailChangeMessages("));
    expect(route.indexOf("sendEmailChangeMessages(")).toBeLessThan(route.indexOf("email_change_requested"));
    expect(route).toContain("hasSignedIn");
  });
  it("opening the link changes nothing: the page only describes it and the change is a button press (POST)", () => {
    const page = src("app/email-change/page.tsx");
    expect(page).toContain("describeEmailChange(");
    expect(page).not.toContain("confirmEmailChange(");
    expect(page).toContain('typeof raw.token === "string"');
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
  it("a person's own change replaces one their coach asked for, and a waiting change shows as a banner", () => {
    expect(src("components/athlete/change-my-email.tsx")).toContain("/api/email-change/cancel-mine");
    expect(src("app/(coach)/layout.tsx")).toContain("<PendingEmailChangeBanner");
    expect(src("components/auth/pending-email-change-banner.tsx")).toContain("Nothing has changed yet");
  });
  it("before the client has signed in, correcting the address cancels the link sent to the old one", () => {
    const route = src("app/api/clients/fix-email/route.ts");
    expect(route).toContain('.from("client_invites").update({ used_at: retiredAt');
  });
  it("it never gets in the way of resending an invite: the 24-hour pause starts only when a change is confirmed", () => {
    expect(src("lib/resend-access.ts")).toContain('"email_changed"');
    const emailChange = src("lib/email-change.ts");
    expect(emailChange.match(/type: "email_changed"/g)?.length).toBe(1);
    expect(emailChange.indexOf('type: "email_changed"')).toBeGreaterThan(emailChange.indexOf("export async function confirmEmailChange"));
    expect(src("app/api/clients/correct-email/route.ts")).not.toContain('"email_changed"');
  });
});
