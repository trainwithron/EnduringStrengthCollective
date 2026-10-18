import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatSet, graduatedByYear, graduationEmail, hasGraduated, hasGraduatedBy, historyLines, parseGraduationYear, type HistorySession } from "./graduation";
import { buildTextPdf, wrapLine } from "./simple-pdf";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("who has graduated", () => {
  it("a class graduates by the calendar year of the day the season is started", () => {
    const june = new Date("2027-06-15T12:00:00Z");
    expect(graduatedByYear(june)).toBe(2027);
    expect(hasGraduated(2026, june)).toBe(true);
    expect(hasGraduated(2027, june)).toBe(true);
    expect(hasGraduated(2028, june)).toBe(false);
    expect(hasGraduated(null, june)).toBe(false);
    expect(hasGraduatedBy(2027, 2027)).toBe(true);
    expect(hasGraduatedBy(2028, 2027)).toBe(false);
    expect(hasGraduated(undefined, june)).toBe(false);
  });

  it("the class-year box: empty clears, four digits between 1990 and 2100 sets, anything else is refused", () => {
    expect(parseGraduationYear("")).toEqual({ ok: true, value: null });
    expect(parseGraduationYear(" 2027 ")).toEqual({ ok: true, value: 2027 });
    for (const bad of ["27", "twenty", "1989", "2101", "2027.5", "20277"]) expect(parseGraduationYear(bad).ok, bad).toBe(false);
  });
});

const sessions: HistorySession[] = [
  { date: "2026-09-10", title: "Lower A", groupName: "Varsity 2026", exercises: [{ name: "Back Squat", sets: [{ weight: 225, reps: 5 }, { weight: 245, reps: 3 }] }, { name: "Plank", sets: [{ weight: null, reps: 60 }] }] },
  { date: "2026-09-03", title: "Upper A", groupName: "Varsity 2026", exercises: [{ name: "Bench Press", sets: [{ weight: 185, reps: 5 }] }, { name: "Back Squat", sets: [{ weight: 255, reps: 1 }] }] },
];

describe("the training history in the PDF", () => {
  const lines = historyLines({ fullName: "Sam Rivera", teamName: "Varsity 2026", unit: "lb", sessions, preparedOn: "2026-12-01" }).map((l) => l.text);

  it("says who it is for, that it went only to them, and how much there is", () => {
    expect(lines[0]).toBe("Sam Rivera");
    expect(lines[1]).toContain("sent only to you");
    expect(lines.join("\n")).toContain("2 workouts from 2026-09-03 to 2026-09-10, 5 sets logged.");
  });

  it("lists the heaviest set of each lift, then every workout in date order", () => {
    const text = lines.join("\n");
    expect(text).toContain("Back Squat: 255 lb x 1 (2026-09-03)");
    expect(text).toContain("Bench Press: 185 lb x 5 (2026-09-03)");
    expect(text).not.toMatch(/Plank: .* x /); // a bodyweight hold has no heaviest weight
    expect(text.indexOf("2026-09-03  Upper A")).toBeLessThan(text.indexOf("2026-09-10  Lower A"));
    expect(text).toContain("Back Squat: 225 lb x 5, 245 lb x 3");
    expect(text).toContain("Plank: 60 reps");
    expect(text).toContain("Plank: 60 reps");
  });

  it("uses the unit the player uses, and writes a plain note when nothing was logged", () => {
    // lifted weights are stored in pounds for everyone: a kilogram player's 225 lb squat is 102.1 kg, never "225 kg"
    expect(formatSet({ weight: 225, reps: 5 }, "kg")).toBe("102.1 kg x 5");
    expect(formatSet({ weight: 225, reps: 5 }, "lb")).toBe("225 lb x 5");
    expect(formatSet({ weight: 0, reps: 10 }, "lb")).toBe("0 x 10");
    expect(formatSet({ weight: null, reps: null }, "lb")).toBe("done");
    const none = historyLines({ fullName: "Sam", teamName: "T", unit: "lb", sessions: [], preparedOn: "2026-12-01" }).map((l) => l.text).join("\n");
    expect(none).toContain("No completed workouts were logged in the app.");
  });

  it("a kilogram player's whole PDF is in kilograms, converted from the stored pounds, in the heaviest sets and in every workout", () => {
    const kg = historyLines({ fullName: "Sam Rivera", teamName: "Varsity 2026", unit: "kg", sessions, preparedOn: "2026-12-01" }).map((l) => l.text).join("\n");
    expect(kg).toContain("Back Squat: 115.7 kg x 1 (2026-09-03)"); // 255 lb
    expect(kg).toContain("Bench Press: 83.9 kg x 5 (2026-09-03)"); // 185 lb
    expect(kg).toContain("Back Squat: 102.1 kg x 5, 111.1 kg x 3"); // 225 lb, 245 lb
    expect(kg).not.toMatch(/\b(255|185|225|245) kg/);
    expect(kg).not.toMatch(/ lb\b/);
  });

  it("the email goes to the player alone: no copy, no parent, no coach, and it says so", () => {
    const mail = graduationEmail({ firstName: "Sam", teamName: "Varsity 2026" });
    expect(mail.subject).toBe("Your training history from Varsity 2026");
    expect(mail.text).toContain("sent only to you");
    expect(mail.text).toContain("Your coach, your team and your family did not get a copy");
  });
});

describe("the PDF file", () => {
  const lines = Array.from({ length: 140 }, (_, i) => ({ text: `Line ${i} (with) a \\ backslash and an accent é and a snowman ☃`, bold: i === 0 }));
  const pdf = buildTextPdf("Your training history", lines);
  const text = pdf.toString("latin1");

  it("is a PDF with a correct cross-reference table", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const count = Number(/xref\n0 (\d+)\n/.exec(text)![1]);
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries.length).toBe(count - 1);
    entries.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length), `object ${i + 1}`).toBe(`${i + 1} 0 obj`));
  });

  it("cuts the lines into pages, and the page count matches", () => {
    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(2);
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(pages);
  });

  it("escapes what a PDF string cannot hold and replaces what Latin-1 cannot", () => {
    expect(text).toContain("\\(with\\)");
    expect(text).toContain("a \\\\ backslash");
    expect(text).toContain("accent é".replace("é", "é"));
    expect(text).toContain("snowman ?");
  });

  it("wraps long lines on spaces and keeps the indent", () => {
    const wrapped = wrapLine("   " + "word ".repeat(40), 40);
    expect(wrapped.length).toBeGreaterThan(3);
    expect(wrapped.every((l) => l.length <= 40)).toBe(true);
    expect(wrapped.slice(1).every((l) => l.startsWith("   "))).toBe(true);
  });
});

describe("how the pieces are wired", () => {
  it("the new-season panel starts unticked for graduates, says who will be emailed, and calls the server afterwards", () => {
    const panel = src("components/coach/desktop/new-season-panel.tsx");
    expect(panel).toContain("athletes.filter((a) => !hasGraduatedBy(a.graduationYear, graduatedByYear()))");
    expect(panel).toContain("will each be emailed a PDF of their own training history, to their own address only");
    expect(panel).toContain('"/api/season/graduate"');
    expect(panel).toContain('rpc("start_next_season"');
    expect(panel).toContain('rpc("start_new_season"'); // the fallback before the database step is applied
    expect(panel).toContain("p_graduates_through: year");
    expect(panel).toContain("body: JSON.stringify({ groupId })");
    expect(panel).not.toMatch(/setFinished\([^)]*\);\s*router\.refresh\(\)/);
  });

  it("the server decides who is emailed from the records, only for a retired and rolled-over season, only to the player, once", () => {
    const route = src("app/api/season/graduate/route.ts");
    expect(route).toContain('seat?.role !== "coach"');
    expect(route).toContain("!group.archived_at || !group.next_season_id");
    expect(route).toContain("hasGraduatedBy(r.graduation_year, year) && !staying.has(r.profile_id)");
    // the deciding year is the one fixed when the season was retired; the request body cannot change it
    expect(route).toContain("decidingYear(group.graduates_through, group.archived_at as string)");
    expect(route).not.toContain("body.year");
    expect(route).not.toMatch(/as \{[^}]*year\?/);
    expect(route).toContain("export const maxDuration = 300;");
    // a claim that was never stamped is never taken over automatically
    expect(route).not.toContain(".update({ claimed_at");
    expect(route).toContain("doubtfulIds.has(r.profile_id)");
    expect(route).toContain("That player is not waiting on a decision.");
    expect(route).toContain("if (error) throw new Error(error.message);");
    expect(route).toContain("mailableAddress(to, auth?.user?.last_sign_in_at)");
    expect(route).toContain("insert({ group_id: groupId, athlete_id: id })"); // the claim, made before anything is sent
    expect(route).toContain("let graduates = allGraduates.filter((r) => !sentIds.has(r.profile_id) && !inFlightIds.has(r.profile_id) && !doubtfulIds.has(r.profile_id));");
    expect(route).toContain("{ limit: PER_CALL }");
    expect(route).not.toContain("limit(MAX_PLAYERS");
    // one recipient: the player's own address, nothing added
    expect(route.match(/sendEmail\(/g)!.length).toBe(1);
    expect(route).toContain("sendEmail(to, mail.subject, mail.text, { name: \"training-history.pdf\", bytes: pdf })");
    expect(route).not.toMatch(/\bcc\b|bcc/i);
  });

  it("the retired season's page offers Send anyway for a doubtful send, and sends no year", () => {
    const again = src("components/coach/desktop/graduation-send-again.tsx");
    expect(again).toContain("Send anyway");
    expect(again).toContain("sendAnyway ? { groupId, sendAnyway } : { groupId }");
    expect(again).not.toContain("year");
  });

  it("the migration only adds: a column, a server-only table and a new function; nothing existing is replaced", () => {
    const sql = src("supabase/migrations/0401_graduation.sql");
    expect(sql).not.toMatch(/create or replace function public\.start_new_season/);
    expect(sql).toContain("create or replace function public.start_next_season");
    expect(sql).toContain("revoke all on public.graduation_exports from anon, authenticated;");
    expect(sql).toContain("if auth.uid() is null or not public.is_group_coach(p_group) then");
  });

  it("the email can carry one attachment, and sendEmail without one is unchanged", () => {
    const email = src("lib/email.ts");
    expect(email).toContain("attachment?: EmailAttachment");
    expect(email).toContain("...(attachment ? { attachment: [{ name: attachment.name, content: Buffer.from(attachment.bytes).toString(\"base64\") }] } : {})");
  });
});

describe("the deciding year and the address check", () => {
  it("the year stored on the retired season wins; an old season falls back to the year it was retired in", async () => {
    const { decidingYear, mailableAddress } = await import("./graduation");
    expect(decidingYear(2027, "2026-06-01T12:00:00Z")).toBe(2027);
    expect(decidingYear(null, "2026-06-01T12:00:00Z")).toBe(2026);
    expect(decidingYear(undefined, "2026-12-31T23:59:59Z")).toBe(2026);
    // an address is only used once the player has signed in with it
    expect(mailableAddress("sam@example.com", "2026-01-01T00:00:00Z")).toBe("sam@example.com");
    expect(mailableAddress("sam@example.com", null)).toBeNull();
    expect(mailableAddress("client-abc@pending.invalid", "2026-01-01T00:00:00Z")).toBeNull();
    expect(mailableAddress("", "2026-01-01T00:00:00Z")).toBeNull();
  });
});
