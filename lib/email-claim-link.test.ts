import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

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
  it("the page passes the address on the account (the coach typed it) and the panel shows it whole", () => {
    const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
    expect(page).toContain("emailOnFile={signInEmailOnFile}");
    expect(page).not.toContain("maskEmail");
  });
});
