import { describe, it, expect } from "vitest";
import { parseRoster, splitPastedRoster, ROSTER_MAX_ROWS } from "./roster-import";

const read = (text: string) => parseRoster(splitPastedRoster(text));

describe("parseRoster", () => {
  it("reads one name per line, with or without an email", () => {
    const { rows, skipped } = read("Jane Smith\nMo Ali, mo@example.com\nSam Lee jane2@example.com\nAnn Cole\tann@example.com");
    expect(skipped).toEqual([]);
    expect(rows.map((r) => [r.name, r.email])).toEqual([
      ["Jane Smith", null],
      ["Mo Ali", "mo@example.com"],
      ["Sam Lee", "jane2@example.com"],
      ["Ann Cole", "ann@example.com"],
    ]);
  });

  it("uses a header row when there is one (name or first and last, and email) and does not add the header as a person", () => {
    const a = parseRoster([["Full Name", "Email"], ["Jane Smith", "JANE@X.COM"]]);
    expect(a.rows).toEqual([{ rowNumber: 2, name: "Jane Smith", email: "jane@x.com" }]);
    const b = parseRoster([["First name", "Last name", "Phone", "Email"], ["Jane", "Smith", "555", "j@x.com"]]);
    expect(b.rows[0]).toMatchObject({ name: "Jane Smith", email: "j@x.com" });
  });

  it("lists every line it did not use, with its line number and why", () => {
    const { rows, skipped } = read("Jane Smith, jane@x.com\n\nbob@x.com\nTom Ray, not-an-email@\nJane Again, JANE@x.com\n12345\nPat Quinn");
    expect(rows.map((r) => r.name)).toEqual(["Jane Smith", "Pat Quinn"]);
    expect(skipped.map((s) => [s.rowNumber, s.reason])).toEqual([[3, "no_name"], [4, "bad_email"], [5, "repeated_email"], [6, "no_name"]]);
  });

  it("two clients may share a name; the preview is told", () => {
    const { rows, repeatedNames } = read("Chris Lee\nChris Lee");
    expect(rows).toHaveLength(2);
    expect(repeatedNames).toEqual(["Chris Lee"]);
  });

  it("stops at the batch limit and says who was left for the next batch", () => {
    const text = Array.from({ length: ROSTER_MAX_ROWS + 3 }, (_, i) => `Person ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`).join("\n");
    const { rows, skipped } = read(text);
    expect(rows).toHaveLength(ROSTER_MAX_ROWS);
    expect(skipped).toHaveLength(3);
    expect(skipped.every((s) => s.reason === "over_limit")).toBe(true);
  });

  it("a very long line (several pasted together) is not one name", () => {
    const { rows, skipped } = read("a".repeat(120));
    expect(rows).toHaveLength(0);
    expect(skipped[0].reason).toBe("name_too_long");
  });
});
