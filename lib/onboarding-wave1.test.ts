import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sortClaimCandidates, type ClaimCandidate } from "./claim-links-all";
import { PLACEHOLDER_EMAIL_DOMAIN } from "./placeholder-email";

// Onboarding wave 1 (Ron, Nov 20: "onboarding smoothness is a priority go ahead and build all o1-o7").
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

const person = (over: Partial<ClaimCandidate>): ClaimCandidate => ({
  profileId: "p",
  groupId: "g",
  fullName: "Jane Smith",
  claimedAt: null,
  email: "jane@example.com",
  lastSignInAt: null,
  hasLiveLink: false,
  ...over,
});

describe("O2: who 'email everyone not signed in yet' emails", () => {
  it("only people who never signed in, with a real email, and no working link already (each person invited once, never chased)", () => {
    const sorted = sortClaimCandidates([
      person({ profileId: "a" }),
      person({ profileId: "b", hasLiveLink: true }),
      person({ profileId: "c", email: `x@${PLACEHOLDER_EMAIL_DOMAIN}` }),
      person({ profileId: "d", email: null }),
      person({ profileId: "e", claimedAt: "2026-11-01T00:00:00Z" }),
      person({ profileId: "f", lastSignInAt: "2026-11-01T00:00:00Z" }),
    ]);
    expect(sorted.eligible.map((c) => c.profileId)).toEqual(["a"]);
    expect(sorted.alreadyLinked.map((c) => c.profileId)).toEqual(["b"]);
    expect(sorted.noEmail.map((c) => c.profileId)).toEqual(["c", "d"]);
  });

  it("someone who opened the link but never chose a password (a sign-in time with no real email) still counts as not signed in", () => {
    const sorted = sortClaimCandidates([person({ profileId: "g", email: `y@${PLACEHOLDER_EMAIL_DOMAIN}`, lastSignInAt: "2026-11-01T00:00:00Z" })]);
    expect(sorted.noEmail.map((c) => c.profileId)).toEqual(["g"]);
  });

  it("the route sends only after the coach confirms, only when email is set up, with per-coach and per-person ceilings, and the same email as the one-client button", () => {
    const src = read("app/api/clients/email-claim-links-all/route.ts");
    expect(src).toContain("body?.confirm !== true");
    expect(src).toContain("isEmailConfigured()");
    expect(src).toContain("email-claim-links-all-day:");
    expect(src).toContain("`email-claim-link:${c.profileId}`");
    expect(src).toContain("sendClaimEmail(");
    expect(src).toContain('.eq("profile_id", user.id)'); // the caller's own coach seat
    expect(read("app/api/clients/email-claim-link/route.ts")).toContain("sendClaimEmail(");
  });
});

describe("O2 safety (Commander review of 55cea37d)", () => {
  const route = read("app/api/clients/email-claim-links-all/route.ts");
  const lib = read("lib/claim-links-all.ts");
  it("never sends on a list that could not be read in full, and a failed link read counts as already linked", () => {
    expect(route).toMatch(/if \(failed\) return NextResponse\.json\(\{ error: "Couldn't read your client list in full, so nothing was sent/);
    expect(lib).toMatch(/if \(error\) \{\s*failed = true;\s*ids\.forEach\(\(id\) => linked\.add\(id\)\);/);
  });
  it("one send at a time per coach, and each person's link is checked again just before their email", () => {
    expect(route).toContain("`email-claim-links-all-lock:${auth.user.id}`, 1, 120");
    expect(route).toContain("if (await liveLinkOrUnknown(serviceRole, c.profileId))");
    // that last check fails safe: a read error counts as already linked
    expect(lib).toMatch(/export async function liveLinkOrUnknown[\s\S]*if \(error\) return true;[\s\S]*catch \{\s*return true;/);
  });
  it("never a team player or anyone with a parent on file", () => {
    expect(lib).toContain("g.team_mode !== true");
    expect(lib).toContain('from("guardian_links")');
    expect(lib).toContain('from("minor_consent")');
  });
  it("the count has its own budget, looks people up side by side, and always takes the same people first", () => {
    expect(route).toContain('rateLimitResponse("email-claim-links-all-count", auth.user.id, 600, 3600)');
    expect(lib).toContain("runPool(looked, 8");
    expect(lib).toContain("stableOrder(unclaimed).slice(0, CLAIM_LINKS_ALL_MAX)");
  });
});

describe("O1 undo keeps anything the coach made (Commander review of 55cea37d)", () => {
  const undo = read("app/api/clients/import-roster/undo/route.ts");
  const migration = read("supabase/migrations/0456_discard_imported_space.sql");
  it("the space is deleted only by the database's own check, otherwise renamed Former client", () => {
    expect(undo).toContain('db.rpc("discard_imported_one_on_one_space", { p_group: groupId, p_coach: coachId })');
    expect(undo).toContain('update({ name: "Former client" })');
    expect(undo).not.toMatch(/from\("group_memberships"\)\.delete\(\)\.eq\("group_id", groupId\)/);
  });
  it("the check reads every table that points at groups from the database itself, and only the server may call it", () => {
    expect(migration).toContain("c.confrelid = 'public.groups'::regclass");
    expect(migration).toContain("c.conrelid not in ('public.group_memberships'::regclass, 'public.client_intake'::regclass)");
    expect(migration).toContain("exception when others then");
    expect(migration).toContain("where id = p_group for update;");
    expect(migration).toContain("set search_path = public, pg_temp");
    expect(migration).toContain("revoke all on function public.discard_imported_one_on_one_space(uuid, uuid) from public, anon, authenticated;");
  });
  it("the paste is the migration word for word", () => {
    const paste = read("supabase/apply/apply-step212-0456.sql").replace(/\r\n/g, "\n");
    expect(paste).toContain(migration.replace(/\r\n/g, "\n"));
  });
});

describe("O1: a pasted list of one-on-one clients", () => {
  const src = read("app/api/clients/import-one-on-one/route.ts");
  it("checks the caller coaches the space and belongs to its organization before making anything", () => {
    expect(src).toContain('membership?.role !== "coach"');
    expect(src).toContain('from("organization_memberships")');
  });
  it("gives each person their own one-on-one space, made as the coach, and takes it back when the person could not be added", () => {
    expect(src).toContain('kind: "one_on_one"');
    expect(src).toContain("createGroupWithCoach(supabase");
    expect(src).toMatch(/if \(!made\.ok\) \{[\s\S]*await discard\(space\.id\)/);
  });
  it("never makes a second account for an email that already has one, and respects the free plan's room", () => {
    expect(src).toContain('rpc("profile_id_for_email"');
    expect(src).toContain('rpc("free_tier_client_headroom"');
  });
  it("Add client offers it next to Add by name, and undo takes back each person with their own space", () => {
    expect(read("components/coach/desktop/add-client-button.tsx")).toContain('mode="one_on_one"');
    const undo = read("app/api/clients/import-roster/undo/route.ts");
    expect(undo).toContain("body.spaces");
    expect(undo).toContain("removeImportedSpace(");
  });
});

describe("O3, O5, O7: the Get started card", () => {
  const card = read("components/coach/desktop/getting-started-card.tsx");
  it("has a moving-from-another-app step that opens Add client on the list", () => {
    expect(card).toContain("Moving from another app?");
    expect(card).toContain("/clients?add=1&import=1");
    expect(read("app/(coach)/clients/page.tsx")).toContain('initialStep={openImport ? "import" : undefined}');
  });
  it("lets a coach ask a person for help moving in (coaches only, rate limited, the platform admin is told)", () => {
    expect(card).toContain("MoveInHelpButton");
    const route = read("app/api/support/move-in-help/route.ts");
    expect(route).toContain('rateLimitResponse("move-in-help"');
    expect(route).toContain('from("organization_memberships")');
    expect(route).toContain("alertPlatformAdmins(");
  });
  it("shows the coach how to see the app the way their clients will", () => {
    expect(card).toContain("/my-space/home");
  });
});
