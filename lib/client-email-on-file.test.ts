import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron: "it doesn't show me what email they have on file right now ... I saw it on my other profile but not on this one."
describe("a client who has signed in shows the email on file", () => {
  const page = read("app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx");
  const form = read("components/coach/correct-client-email.tsx");
  it("the page reads the address on the account for a signed-in client too (never for the coach's own page), with placeholder addresses left out", () => {
    expect(page).toContain('if (signInStatus !== "active" || !selfView) {');
    expect(page).toContain("signInEmail && !isPlaceholderEmail(signInEmail) ? signInEmail : null");
    expect(page).toContain("currentEmail={signInEmailOnFile}");
  });
  it("the line sits above the correct button, and the confirmation names the old and the new address", () => {
    expect(form).toContain("Sign-in email on file: {currentEmail}");
    expect(form.indexOf("Sign-in email on file")).toBeLessThan(form.indexOf("Correct their sign-in email"));
    expect(form).toContain('sign-in email${currentEmail ? ` from ${currentEmail}` : ""} to ${email.trim()}?');
  });
  it("when the sender is not set up the line is still shown above the 'ask them to change it' note", () => {
    expect(page).toContain("Sign-in email on file: {signInEmailOnFile}");
  });
});
