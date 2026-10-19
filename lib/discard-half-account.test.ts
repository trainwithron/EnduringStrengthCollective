import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discardHalfCreatedAccount } from "@/lib/discard-half-account";

const route = readFileSync("app/api/coaches/signup/route.ts", "utf8").replace(/\r\n/g, "\n");

// Oct 19 audit item 16: a signup that failed halfway left the address stuck: the retry said "Check your email" and nothing was ever sent.
describe("removing a half-made account", () => {
  afterEach(() => vi.restoreAllMocks());
  it("deletes the account it is given", async () => {
    const deleteUser = vi.fn(async () => ({ error: null }));
    expect(await discardHalfCreatedAccount({ auth: { admin: { deleteUser } } }, "u1")).toBe(true);
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });
  it("a refusal is logged with the account id and reported as false, never thrown", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await discardHalfCreatedAccount({ auth: { admin: { deleteUser: async () => ({ error: { message: "nope" } }) } } }, "u2")).toBe(false);
    expect(log.mock.calls[0].join(" ")).toContain("u2");
  });
  it("a throw is caught the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await discardHalfCreatedAccount(
        {
          auth: {
            admin: {
              deleteUser: async () => {
                throw new Error("boom");
              },
            },
          },
        },
        "u3"
      )
    ).toBe(false);
  });
});

describe("the signup route", () => {
  it("removes the account when the profile cannot be made", () => {
    const at = route.indexOf("signup: couldn't create the profile");
    expect(route.slice(at, at + 400)).toContain("await discardHalfCreatedAccount(serviceRole, newUserId);");
  });
  it("removes it when the organization cannot be made, but never once the organization exists", () => {
    expect(route).toContain("organizationMade = true;");
    expect(route.indexOf("organizationMade = true;")).toBeGreaterThan(route.indexOf("await createOrganization(serviceRole"));
    expect(route).toContain("if (!organizationMade) await discardHalfCreatedAccount(serviceRole, newUserId);");
  });
  it("still answers the same way: a plain 502 'try again'", () => {
    expect(route).toContain("Couldn't create your profile. Please try again.");
    expect(route).toContain("Couldn't set up your organization. Please try again.");
  });
});
