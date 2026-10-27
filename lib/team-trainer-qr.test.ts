import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import { inviteExpiresAt, linkLifetimeText, planInviteLinks } from "./invite-link-plan";
import { inviteUrl, joinPoster, myPagePoster, posterFileName } from "./qr-poster";
import { AVAILABILITY_HREF, readMyPageQr } from "./my-page-qr";

// Ron, Oct 27: "yes to team qr and that should apply to all coaches, if a gym wants to put up trainer posters itd be nice to scan the qr code and have that link take them to the trainer page".
// A QR code to join a group (its current invite link, which can now never expire) and a QR code to the coach's own public page, each with a poster to print and a picture to save.

// ---- the invite route against a stand-in database ----
type Invite = { id: string; group_id: string; code?: string; expires_at: string | null; revoked_at: string | null };
const state = vi.hoisted(() => ({
  role: "coach" as string | null,
  groupKind: "team",
  invites: [] as { id: string; group_id: string; code?: string; expires_at: string | null; revoked_at: string | null }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "coach" } } }) },
    from: () => {
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: state.role ? { role: state.role } : null }) };
      return q;
    },
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const filters: { col: string; val: unknown; kind: "eq" | "is" | "in" }[] = [];
      let op: "select" | "update" | "insert" | "delete" = "select";
      let payload: Record<string, unknown> = {};
      const matches = (r: Invite) =>
        filters.every((f) => (f.kind === "in" ? (f.val as string[]).includes((r as any)[f.col]) : f.kind === "is" ? (r as any)[f.col] === f.val : (r as any)[f.col] === f.val));
      const run = () => {
        if (table === "groups") return { data: { group_kind: state.groupKind }, error: null };
        if (op === "insert") {
          state.invites.push({ id: `new-${state.invites.length}`, revoked_at: null, ...(payload as any) });
          return { data: null, error: null };
        }
        const rows = state.invites.filter(matches);
        if (op === "update") rows.forEach((r) => Object.assign(r, payload));
        if (op === "delete") state.invites = state.invites.filter((r) => !rows.includes(r));
        return { data: rows.map((r) => ({ ...r })), error: null };
      };
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => (filters.push({ col, val, kind: "eq" }), q),
        is: (col: string, val: unknown) => (filters.push({ col, val, kind: "is" }), q),
        in: (col: string, val: unknown) => (filters.push({ col, val, kind: "in" }), q),
        update: (p: Record<string, unknown>) => ((op = "update"), (payload = p), q),
        insert: (p: Record<string, unknown>) => ((op = "insert"), (payload = p), q),
        delete: () => ((op = "delete"), q),
        maybeSingle: async () => {
          const r = run();
          return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null };
        },
        then: (resolve: (v: unknown) => void) => resolve(run()),
      };
      return q;
    },
  }),
}));

import { POST } from "@/app/api/invites/group/route";

const post = (body: Record<string, unknown>) => POST(new Request("http://x/api/invites/group", { method: "POST", body: JSON.stringify(body) }));
const live = () => state.invites.filter((i) => i.revoked_at === null);

beforeEach(() => {
  state.role = "coach";
  state.groupKind = "team";
  state.invites = [];
});

describe("Never expires", () => {
  it("only an explicit choice means never; anything else is 7 days", () => {
    const now = Date.parse("2026-10-27T12:00:00Z");
    expect(inviteExpiresAt(true, now)).toBeNull();
    for (const v of [undefined, false, "true", 1, null]) expect(inviteExpiresAt(v, now)).toBe("2026-11-03T12:00:00.000Z");
  });
  it("making a link with Never expires saves no end date; without it, 7 days", async () => {
    const made = await (await post({ action: "create", groupId: "g", neverExpires: true })).json();
    expect(made.expiresAt).toBeNull();
    expect(live()).toHaveLength(1);
    expect(live()[0].expires_at).toBeNull();
    const plain = await (await post({ action: "create", groupId: "g" })).json();
    expect(typeof plain.expiresAt).toBe("string");
  });
  it("a never-expiring link still dies the moment the coach makes a new link", async () => {
    await post({ action: "create", groupId: "g", neverExpires: true });
    const first = state.invites[0];
    await post({ action: "create", groupId: "g" });
    expect(first.revoked_at).not.toBeNull();
    expect(live().map((i) => i.id)).not.toContain(first.id);
  });
  it("and the moment the coach cancels it", async () => {
    await post({ action: "create", groupId: "g", neverExpires: true });
    const id = state.invites[0].id;
    expect((await post({ action: "revoke", inviteId: id })).status).toBe(200);
    expect(live()).toHaveLength(0);
  });
  it("an existing link can be made to never expire, and back to 7 days", async () => {
    state.invites = [{ id: "i1", group_id: "g", expires_at: "2026-11-01T00:00:00Z", revoked_at: null }];
    await post({ action: "extend", inviteId: "i1", neverExpires: true });
    expect(state.invites[0].expires_at).toBeNull();
    await post({ action: "extend", inviteId: "i1" });
    expect(typeof state.invites[0].expires_at).toBe("string");
  });
  it("someone who does not coach the group is refused (making, extending, never-expiring)", async () => {
    state.role = "athlete";
    expect((await post({ action: "create", groupId: "g", neverExpires: true })).status).toBe(403);
    state.invites = [{ id: "i1", group_id: "g", expires_at: "2026-11-01T00:00:00Z", revoked_at: null }];
    expect((await post({ action: "extend", inviteId: "i1", neverExpires: true })).status).toBe(403);
    expect(state.invites[0].expires_at).toBe("2026-11-01T00:00:00Z");
    state.role = null;
    expect((await post({ action: "create", groupId: "g" })).status).toBe(403);
  });
  it("a one-on-one client's space has no link, so no QR code", async () => {
    state.groupKind = "one_on_one";
    expect((await post({ action: "create", groupId: "g", neverExpires: true })).status).toBe(422);
    expect(state.invites).toHaveLength(0);
    const page = readFileSync(join(__dirname, "..", "app/(coach)/groups/[groupId]/clients/page.tsx"), "utf8").replace(/\r\n/g, "\n");
    expect(page).toContain('{(group as { group_kind?: string } | null)?.group_kind !== "one_on_one" && (\n        <GroupInvitesPanel');
  });
});

describe("the current link", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const day = 86400000;
  it("a never-expiring newest link is the current one, shown as Never expires", () => {
    const plan = planInviteLinks([{ id: "n", code: "abc", createdAt: now.toISOString(), expiresAt: null, revokedAt: null }], now);
    expect(plan.current).toMatchObject({ id: "n", neverExpires: true, daysLeft: null });
    expect(linkLifetimeText(plan.current!)).toBe("never expires");
    expect(linkLifetimeText({ daysLeft: 1, neverExpires: false })).toBe("works for 1 more day");
  });
  it("a cancelled never-expiring link is gone", () => {
    expect(planInviteLinks([{ id: "n", code: "abc", createdAt: now.toISOString(), expiresAt: null, revokedAt: now.toISOString() }], now).current).toBeNull();
  });
  it("an older never-expiring link under a newer one is listed to cancel", () => {
    const plan = planInviteLinks(
      [
        { id: "old", code: "a", createdAt: new Date(now.getTime() - 30 * day).toISOString(), expiresAt: null, revokedAt: null },
        { id: "new", code: "b", createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 7 * day).toISOString(), revokedAt: null },
      ],
      now,
    );
    expect(plan.current?.id).toBe("new");
    expect(plan.extra).toMatchObject([{ id: "old", neverExpires: true }]);
  });
});

describe("what the codes point at", () => {
  // The drawn code read back as the qrcode package's own code for the address: the same squares mean the same address.
  const same = (a: string, b: string) => {
    const x = QRCode.create(a, {}).modules;
    const y = QRCode.create(b, {}).modules;
    return x.size === y.size && x.data.every((v, i) => v === y.data[i]);
  };
  it("the join code is the exact invite link the panel shows and copies", () => {
    expect(inviteUrl("https://spotlightcoaching.app", "AbC23xyz99")).toBe("https://spotlightcoaching.app/invite/AbC23xyz99");
    expect(same(inviteUrl("https://spotlightcoaching.app", "AbC23xyz99"), "https://spotlightcoaching.app/invite/AbC23xyz99")).toBe(true);
    expect(same(inviteUrl("https://spotlightcoaching.app", "AbC23xyz99"), "https://spotlightcoaching.app/invite/AbC23xyz98")).toBe(false);
    for (const f of ["components/coach/desktop/group-invites-panel.tsx", "components/coach/desktop/add-client-button.tsx"]) {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      expect(src, f).toMatch(/<QrPosterButton url=\{(inviteUrl\(appOriginBrowser\(\), plan\.current\.code\)|link)\}/);
    }
  });
  it("the page code is the exact /c/<slug> address, only while the page is on and published", async () => {
    const db = (page: unknown, site: unknown, error = false) =>
      ({
        from: (table: string) => {
          const q: any = { select: () => q, eq: () => q, maybeSingle: async () => (error ? { data: null, error: { message: "x" } } : { data: table === "coach_booking_pages" ? page : site, error: null }) };
          return q;
        },
      }) as never;
    const ready = await readMyPageQr(db({ slug: "coach-ron", enabled: true }, { published: true }), "ron", "g1");
    expect(ready).toEqual({ kind: "ready", url: "https://spotlightcoaching.app/c/coach-ron" });
    expect(same((ready as { url: string }).url, "https://spotlightcoaching.app/c/coach-ron")).toBe(true);
    // off, no page, unpublished: no code, and where to turn it on
    expect(await readMyPageQr(db({ slug: "coach-ron", enabled: false }, { published: true }), "ron", "g1")).toEqual({ kind: "off", href: AVAILABILITY_HREF });
    expect(await readMyPageQr(db(null, null), "maria", "g1")).toEqual({ kind: "off", href: AVAILABILITY_HREF });
    expect(await readMyPageQr(db({ slug: "coach-ron", enabled: true }, { published: false }), "ron", "g1")).toEqual({ kind: "off", href: "/groups/g1/business/website" });
    expect(await readMyPageQr(db({ slug: "coach-ron", enabled: true }, null), "ron", "g1")).toEqual({ kind: "off", href: "/groups/g1/business/website" });
    // a failed read shows nothing
    expect(await readMyPageQr(db(null, null, true), "ron", "g1")).toBeNull();
  });
  it("reading the page QR never makes, switches on or publishes anything", () => {
    const src = readFileSync(join(__dirname, "my-page-qr.ts"), "utf8");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src).not.toContain("ensureDefaultPublicPage");
  });
});

describe("the posters", () => {
  it("join: the group's name, the coach's name, Scan to join; nothing about a client", () => {
    expect(joinPoster("Bulldogs 14U", "Coach Ron Arnold")).toEqual({ title: "Bulldogs 14U", lines: ["Coach Ron Arnold"], callToAction: "Scan to join Bulldogs 14U" });
    expect(joinPoster("Bulldogs 14U", null)).toEqual({ title: "Bulldogs 14U", lines: [], callToAction: "Scan to join Bulldogs 14U" });
  });
  it("my page: the coach's name, @handle when set, Scan to train with <first name>", () => {
    expect(myPagePoster("Coach Ron Arnold", "coach.ron")).toEqual({ title: "Coach Ron Arnold", lines: ["@coach.ron"], callToAction: "Scan to train with Ron" });
    expect(myPagePoster("Maria Lopez", null)).toEqual({ title: "Maria Lopez", lines: [], callToAction: "Scan to train with Maria" });
  });
  it("the saved picture's file name", () => {
    expect(posterFileName("Bulldogs 14U")).toBe("bulldogs-14u-qr.png");
    expect(posterFileName("!!!")).toBe("spotlight-qr.png");
  });
  it("printing shows only the poster, black on white, made in the browser (no outside service)", () => {
    const css = readFileSync(join(__dirname, "..", "app/globals.css"), "utf8");
    expect(css).toContain("body:has(> .qr-poster-sheet) > *:not(.qr-poster-sheet)");
    const button = readFileSync(join(__dirname, "..", "components/coach/qr-poster-button.tsx"), "utf8");
    expect(button).toContain('from "qrcode"');
    expect(button).toContain("window.print()");
    expect(button).not.toMatch(/fetch\(|https?:\/\//);
  });
});

describe("where they are", () => {
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
  it("Show QR code next to the group's link on the computer (Clients) and in Add client > Invite link (the phone's way to the link), with Never expires", () => {
    const panel = read("components/coach/desktop/group-invites-panel.tsx");
    expect(panel).toContain("content={joinPoster(groupName, coachName)}");
    expect(panel).toContain('call({ action: "create", groupId, neverExpires }, "create")');
    expect(panel).toContain('call({ action: "extend", inviteId: plan.current!.id, neverExpires: true }, "never")');
    expect(panel).toContain('{plan.current.neverExpires ? "Never expires"');
    const add = read("components/coach/desktop/add-client-button.tsx");
    expect(add).toContain('JSON.stringify({ action: "create", groupId: selectedGroupId, neverExpires })');
    expect(add).toContain("<QrPosterButton url={link}");
    // the group's current link (and its QR code) shows first, so reaching the code never needs a new link that would stop a printed poster
    expect(add).toContain("<QrPosterButton url={currentLink.url}");
    expect(add).toContain('{submitting ? "Making…" : currentLink ? "New link" : "Make the link"}');
    expect(add).toContain('.from("group_invites").select("id, code, created_at, expires_at, revoked_at").eq("group_id", selectedGroupId).is("revoked_at", null)');
  });
  it("My page QR code beside the Instagram handle in the coach's own Settings (computer and phone), never when viewing as someone", () => {
    const page = read("app/(coach)/groups/[groupId]/settings/page.tsx");
    expect(page).toContain("const myPageQr = isCoach && !viewingOther ? await readMyPageQr(supabase, user.id, params.groupId) : null;");
    const handleAt = page.indexOf('<InstagramHandleField coachId={user.id}');
    const qrAt = page.indexOf("<div data-my-page-qr>");
    expect(qrAt).toBeGreaterThan(handleAt);
    expect(page.slice(handleAt, qrAt)).not.toContain("<SettingsGroup");
    expect(page).toContain("{TURN_ON_PAGE_TEXT}");
  });
  it("buttons are at least 44 px tall on the phone", () => {
    const button = read("components/coach/qr-poster-button.tsx");
    for (const m of button.matchAll(/<button[^>]*className="([^"]*)"/g)) expect(m[1]).toContain("min-h-11");
    expect(read("app/(coach)/groups/[groupId]/settings/page.tsx")).toContain('<Link href={myPageQr.href} className="min-h-11');
    expect(read("components/coach/desktop/add-client-button.tsx")).toContain('<label className="min-h-11 mb-2 inline-flex items-center gap-2 font-body text-sm text-chalk">');
  });
});
