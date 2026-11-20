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
