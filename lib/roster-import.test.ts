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

  it("a comma inside quotes stays in its cell and the quotes are not kept in the name", () => {
    const { rows, skipped } = read('"Doe, Jane",jane@x.com\n"Lee, Sam"');
    expect(skipped).toEqual([]);
    expect(rows.map((r) => [r.name, r.email])).toEqual([["Doe, Jane", "jane@x.com"], ["Lee, Sam", null]]);
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

  it("takes up to 250 people in one batch (Nov 20: a coach moving in brings their whole list)", () => {
    expect(ROSTER_MAX_ROWS).toBe(250);
  });

  it("reads another coaching app's client export as it is: the app's column names, a title line above the header, extra columns ignored", () => {
    // Trainerize-style: "Client First Name" / "Client Last Name" / "Client Email", with a title row first.
    const trainerize = parseRoster([
      ["Client export 11/20/2026"],
      ["Client First Name", "Client Last Name", "Client Email", "Phone", "Program"],
      ["Jane", "Smith", "Jane@X.com", "555", "Strength 1"],
    ]);
    // the title line is listed as not used, never silently dropped
    expect(trainerize.skipped.map((s) => [s.rowNumber, s.reason])).toEqual([[1, "above_header"]]);
    expect(trainerize.rows).toEqual([{ rowNumber: 3, name: "Jane Smith", email: "jane@x.com" }]);
    // TrueCoach-style: "Name" and "Email Address".
    const truecoach = parseRoster([["Name", "Email Address", "Created"], ["Mo Ali", "mo@x.com", "2025-01-02"]]);
    expect(truecoach.rows[0]).toMatchObject({ name: "Mo Ali", email: "mo@x.com" });
    // Everfit-style: "Client Name", "Email", "Status".
    const everfit = parseRoster([["Client Name", "Email", "Status"], ["Ann Cole", "ann@x.com", "Active"]]);
    expect(everfit.rows[0]).toMatchObject({ name: "Ann Cole", email: "ann@x.com" });
  });

  it("a client the old app marks archived or inactive is listed as not added, with why", () => {
    const { rows, skipped } = parseRoster([
      ["Client Name", "Email", "Status"],
      ["Ann Cole", "ann@x.com", "Active"],
      ["Old Timer", "old@x.com", "Archived"],
      ["Gone Guy", "", "Inactive"],
      ["Paused Pat", "pat@x.com", "Paused"],
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Ann Cole", "Paused Pat"]);
    expect(skipped.map((s) => [s.rowNumber, s.reason])).toEqual([[3, "archived"], [4, "archived"]]);
    expect(skipped[0].detail).toContain("Old Timer");
  });

  it("an address State column is not a status column, so it never hides the Archived flags", () => {
    const { rows, skipped } = parseRoster([
      ["Name", "Email", "State", "Status"],
      ["Ann Cole", "ann@x.com", "Ohio", "Active"],
      ["Old Timer", "old@x.com", "Texas", "Archived"],
    ]);
    expect(rows.map((r) => r.name)).toEqual(["Ann Cole"]);
    expect(skipped.map((s) => s.reason)).toEqual(["archived"]);
  });

  it("a header further down than the top five rows is not looked for (those rows are people)", () => {
    const cells = [["A One"], ["B Two"], ["C Three"], ["D Four"], ["E Five"], ["Name", "Email"]];
    const { rows } = parseRoster(cells);
    expect(rows.map((r) => r.name)).toContain("A One");
  });

  it("a very long line (several pasted together) is not one name", () => {
    const { rows, skipped } = read("a".repeat(120));
    expect(rows).toHaveLength(0);
    expect(skipped[0].reason).toBe("name_too_long");
  });
});
