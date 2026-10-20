import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appendNoteLine, sessionNoteLine, saveSessionNote } from "./session-note";

// Ron, Oct 19 (screenshot of "Did Sawyer S.'s session this afternoon (4:00 PM) happen?"): "it would be nice to have a small notes section in this notification".
const cards = readFileSync(join(__dirname, "..", "components", "coach", "session-check-cards.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("a note on the did-it-happen card", () => {
  it("is one line naming the session, on the coach's clock", () => {
    // 4:00 PM in Los Angeles on Oct 19 = 23:00 UTC
    expect(sessionNoteLine("2026-10-19T23:00:00Z", "America/Los_Angeles", "  knee felt better ")).toBe("Oct 19, 4:00 PM session: knee felt better");
  });
  it("is added under the client's existing private notes; the old text is never changed", () => {
    expect(appendNoteLine("Prefers mornings.\nBad left knee.", "Oct 19, 4:00 PM session: knee felt better")).toBe("Prefers mornings.\nBad left knee.\nOct 19, 4:00 PM session: knee felt better");
    expect(appendNoteLine("", "Oct 19, 4:00 PM session: x")).toBe("Oct 19, 4:00 PM session: x");
    expect(appendNoteLine(null, "L")).toBe("L");
    expect(appendNoteLine("A\n\n  ", "L")).toBe("A\nL");
  });
  it("writes to athlete_notes (one row per client and group, the same upsert as the notes editor), and an empty note writes nothing", async () => {
    const writes: unknown[] = [];
    const db: any = {
      auth: { getUser: async () => ({ data: { user: { id: "coach" } } }) },
      from: () => {
        const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "n1", body: "Old note." }, error: null }), upsert: (row: unknown, opts: unknown) => (writes.push({ row, opts }), Promise.resolve({ error: null })) };
        return q;
      },
    };
    expect(await saveSessionNote(db, { athleteId: "a", groupId: "g", startIso: "2026-10-19T23:00:00Z", timezone: "America/Los_Angeles", text: "   " })).toBe(true);
    expect(writes).toHaveLength(0);
    expect(await saveSessionNote(db, { athleteId: "a", groupId: "g", startIso: "2026-10-19T23:00:00Z", timezone: "America/Los_Angeles", text: "felt strong" })).toBe(true);
    expect(writes[0]).toMatchObject({ row: { id: "n1", athlete_id: "a", group_id: "g", body: "Old note.\nOct 19, 4:00 PM session: felt strong", created_by: "coach" }, opts: { onConflict: "athlete_id,group_id" } });
  });
  it("the card has the small field, saves it with Yes / No / Reschedule or on leaving the field, and never adds the same text twice", () => {
    expect(cards).toContain('placeholder="Note (only you see this)"');
    expect(cards).toContain("onBlur={() => void saveNote(s)}");
    expect(cards.match(/if \(!\(await saveNote\(s\)\)\) \{/g)?.length).toBe(2);
    expect(cards).toContain("void saveNote(s);\n                setMoving(");
    expect(cards).toContain("const running = inFlight.current.get(s.bookingId);\n    if (running) return running;");
    expect(cards).toContain("if (!text || savedText.current.get(s.bookingId) === text) return Promise.resolve(true);");
    expect(cards).toContain("Added to {s.name}&apos;s private notes.");
  });
});
