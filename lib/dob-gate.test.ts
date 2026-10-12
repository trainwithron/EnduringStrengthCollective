import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dobGateState, validDateOfBirth } from "@/lib/dob-gate";

const NOW = new Date("2026-10-12T12:00:00");

describe("which clients are asked for a date of birth, and which stop at the consent message", () => {
  it("a coach, or anyone who is not a client, is never asked", () => {
    expect(dobGateState({ isClientOnly: false, dateOfBirth: null, consentVerified: false, now: NOW })).toBe("ok");
  });
  it("a client with no date on file is asked first, whatever else is true", () => {
    expect(dobGateState({ isClientOnly: true, dateOfBirth: null, consentVerified: false, now: NOW })).toBe("need_dob");
    expect(dobGateState({ isClientOnly: true, dateOfBirth: null, consentVerified: true, now: NOW })).toBe("need_dob");
  });
  it("a child under 13 stops until a parent's consent is verified; with it, they go on", () => {
    expect(dobGateState({ isClientOnly: true, dateOfBirth: "2018-01-05", consentVerified: false, now: NOW })).toBe("blocked");
    expect(dobGateState({ isClientOnly: true, dateOfBirth: "2018-01-05", consentVerified: true, now: NOW })).toBe("ok");
  });
  it("a client who is 13 or older goes on", () => {
    expect(dobGateState({ isClientOnly: true, dateOfBirth: "2013-10-12", consentVerified: false, now: NOW })).toBe("ok");
    expect(dobGateState({ isClientOnly: true, dateOfBirth: "1988-03-30", consentVerified: false, now: NOW })).toBe("ok");
  });
});

describe("a typed date of birth", () => {
  it("accepts a real past date and refuses impossible, future and ancient ones", () => {
    expect(validDateOfBirth("1990-04-23", NOW)).toBe(true);
    expect(validDateOfBirth("2026-02-31", NOW)).toBe(false);
    expect(validDateOfBirth("2027-01-01", NOW)).toBe(false);
    expect(validDateOfBirth("1890-01-01", NOW)).toBe(false);
    expect(validDateOfBirth("04/23/1990", NOW)).toBe(false);
    expect(validDateOfBirth("", NOW)).toBe(false);
  });
});

describe("the date is asked before the client reaches their group", () => {
  const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");
  it("the sign-in gate covers group and session pages and sends to the one-field screen", () => {
    const mw = read("lib/supabase/middleware.ts");
    expect(mw).toContain('pathname.startsWith("/groups") || pathname.startsWith("/sessions")');
    expect(mw).toContain('new URL("/birthday", request.url)');
  });
  it("the date is saved where the app already reads it", () => {
    expect(read("components/intake/birthday-form.tsx")).toContain('from("client_intake").upsert({ athlete_id: user.id, group_id: groupId, date_of_birth: dob }');
  });
});
