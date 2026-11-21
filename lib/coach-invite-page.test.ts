// The Invite coach form's copied link (/coach-invite/<id>.<signature>, review Nov 21): one shape for both kinds of invitation; the page sends only the person it is for on, and shows anyone
// else the same plain page whatever the link is.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.JOIN_LINK_SECRET = "test-secret";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  join: null as Record<string, unknown> | null,
  invite: null as Record<string, unknown> | null,
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "coach_join_links" ? state.join : state.invite, error: null }) };
      return q;
    },
  }),
}));

import { inviteLinkToken, joinLinkToken, parseInviteLinkToken } from "@/lib/coach-join-link";
import CoachInviteLinkPage from "@/app/coach-invite/[token]/page";

const JOIN_ID = "11111111-1111-4111-8111-111111111111";
const INVITE_ID = "22222222-2222-4222-8222-222222222222";
const future = new Date(Date.now() + 86_400_000).toISOString();
const openJoin = { id: JOIN_ID, organization_id: "o", profile_id: "p-new", kind: "invite", created_by: "owner", created_at: future, expires_at: future, used_at: null, revoked_at: null };
const openInvite = { id: INVITE_ID, invited_profile_id: "p-existing", answered_at: null, expires_at: future };

async function open(id: string): Promise<string> {
  try {
    const el = await CoachInviteLinkPage({ params: Promise.resolve({ token: inviteLinkToken(id) }) });
    return `PAGE ${renderToStaticMarkup(el as never)}`;
  } catch (e) {
    return (e as Error).message;
  }
}

beforeEach(() => {
  state.user = null;
  state.join = null;
  state.invite = null;
});

describe("the token", () => {
  it("is the same shape for both kinds and is not a join link's token", () => {
    const a = inviteLinkToken(JOIN_ID);
    const b = inviteLinkToken(INVITE_ID);
    expect(a.length).toBe(b.length);
    expect(parseInviteLinkToken(a)).toBe(JOIN_ID);
    expect(parseInviteLinkToken(joinLinkToken(JOIN_ID))).toBeNull();
    expect(parseInviteLinkToken(`${JOIN_ID}.forged`)).toBeNull();
  });
});

describe("where it goes", () => {
  it("a new address's link, opened signed out (the new person), goes on to choose a password", async () => {
    state.join = openJoin;
    expect(await open(JOIN_ID)).toBe(`REDIRECT /join-coach/${joinLinkToken(JOIN_ID)}`);
  });
  it("an existing account's invitation goes on only for that account; signed out it asks to sign in first", async () => {
    state.invite = openInvite;
    expect(await open(INVITE_ID)).toMatch(/^REDIRECT \/login\?next=/);
    state.user = { id: "p-existing" };
    expect(await open(INVITE_ID)).toBe(`REDIRECT /org-invite/${INVITE_ID}`);
  });
  it("anyone else signed in (the person who invited them) sees the same plain page for both kinds, naming nobody", async () => {
    state.user = { id: "owner" };
    state.join = openJoin;
    const a = await open(JOIN_ID);
    state.join = null;
    state.invite = openInvite;
    const b = await open(INVITE_ID);
    expect(a.startsWith("PAGE ")).toBe(true);
    expect(a).toBe(b);
    expect(a).not.toMatch(/p-new|p-existing|org-invite|join-coach/);
  });
  it("a link that is not open, or a forged one, never says why", async () => {
    state.user = { id: "owner" };
    const closed = await open(INVITE_ID);
    state.invite = { ...openInvite, answered_at: future };
    expect(await open(INVITE_ID)).toBe(closed);
    const forged = await CoachInviteLinkPage({ params: Promise.resolve({ token: `${INVITE_ID}.forged` }) });
    expect(`PAGE ${renderToStaticMarkup(createElement(() => forged as never))}`).toBe(closed);
  });
});
