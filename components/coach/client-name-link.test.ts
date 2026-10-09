import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const shell = readFileSync(join(__dirname, "coach-desktop-shell.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("the client's name in the top bar opens their profile", () => {
  it("only in a one-on-one space, and to the same profile address the Clients page uses", () => {
    expect(shell).toContain('groupKind === "one_on_one" && soloClientId ? (');
    expect(shell).toContain("href={`/groups/${groupId}/athletes/${soloClientId}`}");
    // the client is found from the space's one athlete; group and organization names stay plain text
    expect(shell).toContain('.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "athlete")');
    expect(shell.indexOf("soloClientId ? (")).toBeLessThan(shell.indexOf("{groupName}\n            </p>\n          )}"));
  });
});
