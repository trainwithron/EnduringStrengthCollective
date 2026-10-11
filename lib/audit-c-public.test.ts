import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("pages a signed-out or brand-new person lands on", () => {
  it("set-password and confirm-email say they are signing you in, never a blank page", () => {
    for (const file of ["app/set-password/page.tsx", "app/confirm-email/page.tsx"]) {
      const src = read(file);
      expect(src).toContain("<Suspense fallback={<SigningInNotice />}>");
      expect(src).not.toContain("fallback={null}");
      expect(src).not.toMatch(/if \(checking[^)]*\) return null;/);
    }
    expect(read("components/auth/signing-in-notice.tsx")).toContain("Signing you in…");
  });
  it("a signed-in person with no group sees a short note, not the sales page", () => {
    const src = read("app/page.tsx");
    expect(src).toContain("You&apos;re signed in");
    expect(src).toContain("Ask your coach to add you");
    expect(src.indexOf("Ask your coach to add you")).toBeLessThan(src.indexOf("<Hero />"));
  });
  it("the sign-in link's Continue page is branded and titled", () => {
    const src = read("app/claim/[token]/route.ts");
    expect(src).toContain("<title>Welcome to Spotlight</title>");
    expect(src).toContain("Spotlight Coaching</p>");
  });
  it("an invalid QR code has a way home", () => {
    const src = read("app/scan/[exerciseId]/page.tsx");
    expect(src).toContain('<Link href="/"');
    expect(src).toContain("Back home");
  });
  it("find-a-coach links a coach to their booking page only when booking is on, and drops the 'not an error' line", () => {
    const src = read("app/find-a-coach/page.tsx");
    expect(src).toContain("canSignProofs() && isEmailConfigured()");
    expect(src).toContain(".eq(\"enabled\", true)");
    expect(src).toContain("/book/${slugByCoach.get(r.coachId)}");
    expect(src).not.toContain("expected, not an error");
  });
  it("there is no 'Apple Health / Coming soon' row", () => {
    const src = read("components/athlete/wearable-placeholder.tsx");
    expect(src).not.toContain("COMING_SOON");
    expect(src).not.toContain("Coming soon");
  });
  it("shared links name the real site when no site address is configured", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('?? "https://spotlightcoaching.app"');
    expect(layout).not.toContain("vercel.app");
  });
  it("the shared no-access card already has a Home button", () => {
    expect(read("components/shared/no-access.tsx")).toContain("Go to Home");
  });
});
