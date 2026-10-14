import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clientNamedIn, matchTemplates, type TemplateRef } from "@/lib/template-match";
import { everySlotFilled, type ReviewRow } from "@/lib/use-template";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const t = (id: string, name: string): TemplateRef => ({ id, name, groupId: "g" });
const templates = [t("1", "Mom of two"), t("2", "Mom of three"), t("3", "Football in-season"), t("4", "Mom of two limited overhead"), t("5", "Template")];

describe("a typed request that names one of the coach's templates", () => {
  it("matches when every meaningful word of the name is in the words, ignoring the word template", () => {
    expect(matchTemplates("build the 30-year-old mom of two template for someone", templates).map((m) => m.id)).toEqual(["1"]);
    expect(matchTemplates("use my football in season plan", templates).map((m) => m.id)).toEqual(["3"]);
  });
  it("does not match a neighbour, and a name with only filler words never matches", () => {
    expect(matchTemplates("a mom of three week", templates).map((m) => m.id)).toEqual(["2"]);
    expect(matchTemplates("build a template", templates)).toEqual([]);
    expect(matchTemplates("tell me about squats", templates)).toEqual([]);
  });
  it("the most specific name wins, and equally specific ones are all offered so the coach picks", () => {
    expect(matchTemplates("mom of two with limited overhead range", templates).map((m) => m.id)).toEqual(["4"]);
    expect(matchTemplates("mom of two mom of three", templates).map((m) => m.id).sort()).toEqual(["1", "2"]);
  });
});

describe("a client named in the words", () => {
  const clients = [
    { id: "a", fullName: "Sam Rivers" },
    { id: "b", fullName: "Jessica Smith" },
    { id: "c", fullName: "Sam Wu" },
  ];
  it("is chosen only when exactly one first name is in the words", () => {
    expect(clientNamedIn("the mom of two template for Jessica", clients)?.id).toBe("b");
    expect(clientNamedIn("for Sam", clients)).toBeNull();
    expect(clientNamedIn("for someone new", clients)).toBeNull();
  });
});

describe("where it shows", () => {
  it("under the AI builder box and the Ask box, as an offer that opens the usual panel with the words filled in", () => {
    expect(read("components/coach/desktop/ai-program-builder-box.tsx")).toContain('{phase === "idle" && <TemplateSuggestion text={text} />}');
    expect(read("components/coach/desktop/program-chat-panel.tsx")).toContain("<TemplateSuggestion text={input} />");
    const s = read("components/coach/desktop/template-suggestion.tsx");
    expect(s).toContain("Use your template");
    expect(s).toContain("Which template?");
    expect(s).toContain("initialText={text} initialClientId={clientId}");
  });
});

describe("Make waits for every slot", () => {
  const row = { rowId: "r1", pick: "Landmine Press" } as unknown as ReviewRow;
  it("an empty pick (nothing on the ladder fits) is not filled; a chosen one is", () => {
    expect(everySlotFilled([row], { r1: "" })).toBe(false);
    expect(everySlotFilled([row], { r1: "Kettlebell Press" })).toBe(true);
    expect(everySlotFilled([row], {})).toBe(true);
  });
});
