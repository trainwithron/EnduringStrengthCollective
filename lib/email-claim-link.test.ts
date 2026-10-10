import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildClaimEmail } from "@/lib/client-claim";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the sign-in email", () => {
  const m = buildClaimEmail("https://spotlightcoaching.app/claim/abc", "Max", "Ron Arnold");
  it("comes from the coach's name, with the link, the 48 hour note, and an ignore line", () => {
    expect(m.subject).toBe("Ron Arnold invited you to Spotlight Coaching");
    expect(m.text).toContain("Hi Max,");
    expect(m.text).toContain("Ron Arnold set up your training in Spotlight Coaching.");
    expect(m.text).toContain("https://spotlightcoaching.app/claim/abc");
    expect(m.text).toContain("expires in 48 hours");
    expect(m.text).toContain("If you weren't expecting this, you can ignore this email.");
  });
  it("still reads well with no names", () => {
    const n = buildClaimEmail("https://x/claim/t", "", null);
    expect(n.subject).toBe("Your coach invited you to Spotlight Coaching");
    expect(n.text.startsWith("Hi,")).toBe(true);
  });
});

describe("the email route", () => {
  const route = read("app/api/clients/email-claim-link/route.ts");
  it("only the client's own coach, only for an unclaimed client", () => {
    expect(route).toContain("loadUnclaimedClient(supabase, serviceRole, user.id, groupId, athleteId)");
  });
  it("only ever sends to the address on the account, never one from the request", () => {
    expect(route).toContain("serviceRole.auth.admin.getUserById(athleteId)");
    expect(route).toContain("sendEmail(email,");
    expect(route).not.toContain("body.email");
    expect(route).toContain("isPlaceholderEmail(email)");
  });
  it("says plainly when email sending is not set up, and limits 5 a day per client", () => {
    expect(route).toContain("isSendGridConfigured()");
    expect(route).toContain("Email sending isn't set up yet");
    expect(route).toContain("`email-claim-link:${athleteId}`, 5, 24 * 3600");
  });
  it("replacing a working link needs the coach's confirmation, and a failed send hands the link back", () => {
    expect(route).toContain("body.confirmReplace !== true && (await hasLiveClaimLink(serviceRole, athleteId))");
    expect(route).toContain("needsConfirm: true");
    expect(route).toContain("link: minted.link");
  });
  it("the plain link route and this one share the same minting code", () => {
    expect(read("app/api/clients/invite-link/route.ts")).toContain("mintClaimLink(");
    expect(route).toContain("mintClaimLink(");
  });
});

describe("the buttons", () => {
  it("the sign-in panel offers it when an email is on file and right after saving one", () => {
    const panel = read("components/coach/client-signin-panel.tsx");
    expect(panel).toContain("maskedEmail && !justSaved");
    expect(panel).toContain("Saved. Email the sign-in link now?");
    expect(panel).toContain("Copy");
    expect(panel).toContain("Text it from my phone");
  });
  it("the Add client screen offers it when the client was added with an email", () => {
    const add = read("components/coach/desktop/add-client-button.tsx");
    expect(add).toContain("added.hasEmail");
    expect(add).toContain("<EmailClaimLinkButton");
  });
  it("the page passes only a hidden version of the address", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("emailMasked={signInEmailMasked}");
    expect(page).toContain("maskEmail(signInEmail)");
  });
});
