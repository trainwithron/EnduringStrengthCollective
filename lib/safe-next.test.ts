import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { safeNextPath } from "@/lib/safe-next";

const origin = "https://spotlightcoaching.app";
describe("where to go after signing in", () => {
  it("follows a path inside the app, with its query", () => {
    expect(safeNextPath("/groups/abc/programs?edit=1", origin)).toBe("/groups/abc/programs?edit=1");
    expect(safeNextPath("/dashboard", origin, "/x")).toBe("/dashboard");
  });
  it("refuses other sites, protocol-relative addresses and backslash tricks", () => {
    const slash = String.fromCharCode(92);
    const bad = ["https://evil.com", "//evil.com", "/" + slash + "evil.com", "/" + slash + slash + "evil.com", slash + slash + "evil.com", "javascript:alert(1)", "/ok" + String.fromCharCode(0), "evil.com", "", null, undefined, 5];
    for (const b of bad) {
      expect(safeNextPath(b, origin, "/home"), JSON.stringify(b)).toBe("/home");
    }
  });
  it("both places that follow ?next= use it", () => {
    for (const p of ["app/login/page.tsx", "app/choose-organization/select/route.ts"]) {
      expect(readFileSync(join(__dirname, "..", p), "utf8")).toContain("safeNextPath(");
    }
  });
});
