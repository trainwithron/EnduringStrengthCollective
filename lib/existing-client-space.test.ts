import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickExistingSpace, type ClientSpaceCandidate } from "@/lib/existing-client-space";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const c = (groupId: string, groupKind: string, organizationId: string | null, coachedByCaller = true): ClientSpaceCandidate => ({ groupId, groupKind, organizationId, coachedByCaller });

// Oct 19 audit: Ron typed an existing client's email and the client got "X invited you to be their client" while an empty second space was left behind.
describe("which existing space to resend access for", () => {
  it("the one-on-one space they are already in, in the same organization, that the caller coaches", () => {
    expect(pickExistingSpace([c("old", "one_on_one", "org1")], "new", "org1")).toBe("old");
  });
  it("never the space being added to", () => {
    expect(pickExistingSpace([c("new", "one_on_one", "org1")], "new", "org1")).toBeNull();
  });
  it("not another organization's space, and not one the caller does not coach", () => {
    expect(pickExistingSpace([c("other-org", "one_on_one", "org2")], "new", "org1")).toBeNull();
    expect(pickExistingSpace([c("not-mine", "one_on_one", "org1", false)], "new", "org1")).toBeNull();
  });
  it("prefers their one-on-one space over a group; falls back to a group", () => {
    expect(pickExistingSpace([c("team", "team", "org1"), c("solo", "one_on_one", "org1")], "new", "org1")).toBe("solo");
    expect(pickExistingSpace([c("team", "team", "org1")], "new", "org1")).toBe("team");
  });
  it("no organization known means nothing is matched", () => {
    expect(pickExistingSpace([c("old", "one_on_one", null)], "new", null)).toBeNull();
  });
});

describe("the add flow", () => {
  const route = read("app/api/clients/invite/route.ts");
  it("resends access for the existing space (the same resend a profile uses) before any invitation is made", () => {
    expect(route).toContain("pickExistingSpace(candidates, groupId,");
    expect(route).toContain("groupId: existingSpace");
    expect(route.indexOf("pickExistingSpace(candidates")).toBeLessThan(route.indexOf("space_invites"));
    expect(route.indexOf("pickExistingSpace(candidates")).toBeLessThan(route.indexOf("checkOneOnOneGroupHasRoom(serviceRole"));
  });
  it("the form drops the empty space it just made, through the server's empty-space check, and keeps the note", () => {
    const form = read("components/coach/desktop/add-client-button.tsx");
    expect(form).toContain("if (data.existingSpace && createdGroupIdRef.current && data.groupId !== createdGroupIdRef.current) {");
    expect(form).toContain("void removeEmptySpace(createdGroupIdRef.current);");
    expect(form).toContain("setResentNote(");
  });
});
