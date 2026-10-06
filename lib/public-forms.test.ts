import { describe, expect, it } from "vitest";
import { validateDiscoveryBooking, validateGymLead } from "@/lib/public-forms";

const NOW = new Date("2026-10-10T12:00:00Z");
const COACH = "11111111-1111-4111-8111-111111111111";
const ok = { coachId: COACH, startAt: "2026-10-12T15:00:00Z", endAt: "2026-10-12T15:30:00Z", name: "Sam Lee", email: "Sam@Example.com", phone: "555-123-4567", message: "Hi" };

describe("validateDiscoveryBooking", () => {
  it("accepts a normal request and cleans it", () => {
    const r = validateDiscoveryBooking(ok, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe("sam@example.com");
  });
  it("refuses a time in the past, too far ahead, or of an odd length", () => {
    expect(validateDiscoveryBooking({ ...ok, startAt: "2026-10-09T15:00:00Z", endAt: "2026-10-09T15:30:00Z" }, NOW).ok).toBe(false);
    expect(validateDiscoveryBooking({ ...ok, startAt: "2027-03-01T15:00:00Z", endAt: "2027-03-01T15:30:00Z" }, NOW).ok).toBe(false);
    expect(validateDiscoveryBooking({ ...ok, endAt: "2026-10-12T15:02:00Z" }, NOW).ok).toBe(false);
    expect(validateDiscoveryBooking({ ...ok, endAt: "2026-10-13T15:30:00Z" }, NOW).ok).toBe(false);
  });
  it("refuses a bad coach id, a link in the name, a bad email and over-long fields", () => {
    expect(validateDiscoveryBooking({ ...ok, coachId: "nope" }, NOW).ok).toBe(false);
    expect(validateDiscoveryBooking({ ...ok, name: "Click http://x.example" }, NOW).ok).toBe(false);
    expect(validateDiscoveryBooking({ ...ok, email: "not-an-email" }, NOW).ok).toBe(false);
    expect(validateDiscoveryBooking({ ...ok, message: "x".repeat(600) }, NOW).ok).toBe(false);
    expect(validateDiscoveryBooking({ ...ok, name: "n".repeat(200) }, NOW).ok).toBe(false);
  });
});

describe("validateGymLead", () => {
  const lead = { organizationId: COACH, exerciseLibraryId: "", fullName: "Sam Lee", contactInfo: "555-123-4567", note: "" };
  it("accepts a normal lead", () => {
    const r = validateGymLead(lead);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.exerciseLibraryId).toBeNull();
  });
  it("refuses a bad id, an empty name or contact, a link in the name and long text", () => {
    expect(validateGymLead({ ...lead, organizationId: "x" }).ok).toBe(false);
    expect(validateGymLead({ ...lead, fullName: "" }).ok).toBe(false);
    expect(validateGymLead({ ...lead, contactInfo: "" }).ok).toBe(false);
    expect(validateGymLead({ ...lead, fullName: "www.spam.com now" }).ok).toBe(false);
    expect(validateGymLead({ ...lead, note: "n".repeat(600) }).ok).toBe(false);
  });
});
