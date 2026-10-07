import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const note = src("./exercise-athlete-note.tsx");
const card = src("./exercise-card.tsx");

// The logger's note draft follow-ups (R6a to R6c): a hash of the base, an offered draft kept apart from typing, and drafts that belong to one person.
describe("the exercise note keeps its draft safely", () => {
  it("R6c: the draft is the signed-in person's; anyone else's is removed when the screen opens, and nothing is kept for nobody", () => {
    expect(card).toContain("viewerId={viewerId}");
    expect(note).toContain("viewerId = null");
    expect(note).toContain("clearOtherUsersDrafts(viewerId)");
    expect(note).toContain("if (readOnly || !viewerId) return;");
    expect(note).toContain("if (viewerId) writeNoteDraft(viewerId, sessionExerciseId");
  });
  it("R6b: an offered draft is moved to its own key, and typing while it shows writes only the normal draft", () => {
    expect(note).toContain("writeNoteOffer(viewerId, sessionExerciseId, decision.text)");
    expect(note).toContain("clearNoteOffer(viewerId, sessionExerciseId)");
    // Use it / Discard answer the offer; the field's onChange never touches the offer
    const onChange = note.slice(note.indexOf("onChange={(e) => {"), note.indexOf("onBlur="));
    expect(onChange).not.toContain("Offer");
    expect(onChange).toContain("writeNoteDraft(");
  });
  it("R6a: only a hash of the server note is stored (no second copy of the note)", () => {
    const lib = src("../../lib/note-draft.ts");
    expect(lib).toContain("baseHash: hashNote(base)");
    expect(lib).not.toContain("base,");
  });
});
