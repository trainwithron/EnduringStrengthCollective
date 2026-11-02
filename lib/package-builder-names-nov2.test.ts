import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_KIND_LABEL } from "./package-price";

const manager = readFileSync(join(__dirname, "..", "components/coach/desktop/package-manager.tsx"), "utf8");

describe("package builder wording (Ron, Nov 2)", () => {
  it("the four kinds: training team, program, online coaching, in-person coaching", () => {
    expect(Object.values(PACKAGE_KIND_LABEL)).toEqual(["Training team", "Program", "Online coaching", "In-person coaching"]);
  });

  it("every kind is sold as a Package or a Subscription; no one-session choice", () => {
    expect(manager.match(/\["pack", "Package"\]|\["one_time", "Package"\]/g)).toHaveLength(2);
    expect(manager.match(/\["weekly", "Subscription"\]|\["subscription", "Subscription"\]/g)).toHaveLength(2);
    expect(manager).not.toContain('"One session"');
    expect(manager).not.toContain('<option value="one_time">One time</option>');
  });

  it("an example price is a dim hint, not something that looks typed in", () => {
    expect(manager).toContain('placeholder="e.g. 100"');
    expect(manager).toContain("placeholder:text-steel ");
  });
});
