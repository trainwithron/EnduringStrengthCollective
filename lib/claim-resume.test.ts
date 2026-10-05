import { describe, expect, it } from "vitest";
import { shouldResumeClaim } from "./claim-resume";
import { isPlaceholderEmail, placeholderEmailFor } from "./client-claim";

describe("shouldResumeClaim", () => {
  const placeholder = placeholderEmailFor("abc123");
  it("sends a signed-in client who has not finished claiming back to choose a password", () => {
    expect(shouldResumeClaim(placeholder, "/groups/g1")).toBe(true);
    expect(shouldResumeClaim(placeholder, "/groups/g1/calendar")).toBe(true);
    expect(shouldResumeClaim(placeholder, "/groups")).toBe(true);
  });
  it("leaves the setup screens themselves alone, so there is no loop", () => {
    for (const p of ["/set-password", "/intake", "/login", "/claim/abc", "/claim-invalid", "/"]) expect(shouldResumeClaim(placeholder, p)).toBe(false);
  });
  it("never touches a normal account", () => {
    expect(shouldResumeClaim("ann@example.com", "/groups/g1")).toBe(false);
    expect(shouldResumeClaim(null, "/groups/g1")).toBe(false);
    expect(shouldResumeClaim(undefined, "/groups/g1")).toBe(false);
  });
  it("is the same placeholder rule the claim flow uses", () => {
    expect(isPlaceholderEmail(placeholder)).toBe(true);
  });
});
