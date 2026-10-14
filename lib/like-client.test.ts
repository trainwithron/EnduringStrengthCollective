import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findLikeReference } from "@/lib/like-client";
import { outlineLines, referenceBlock } from "@/lib/reference-context";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const clients = [
  { id: "rob", fullName: "Rob Derrick" },
  { id: "sam", fullName: "Sam Rivers" },
  { id: "sam2", fullName: "Sam Wu" },
  { id: "kim", fullName: "Kim Lee" },
];

// Ron: "similar to Rob's bad back, we need to program around it" / "same protocols as Rob Derrick". The AI just LOOKS at how the coach programs for that client. Nothing is copied or stored.
describe("a request that points at another client", () => {
  it("finds the client by first name or full name", () => {
    expect(findLikeReference("a program similar to Rob's bad back", clients)?.client?.id).toBe("rob");
    expect(findLikeReference("same protocols as Rob Derrick", clients)?.client?.id).toBe("rob");
    expect(findLikeReference("build it like Kim", clients)?.client?.id).toBe("kim");
    expect(findLikeReference("Rob's protocols please", clients)?.client?.id).toBe("rob");
  });
  it("two clients with that first name means the coach is asked", () => {
    const ref = findLikeReference("same as Sam", clients);
    expect(ref?.client).toBeNull();
    expect(ref?.options.map((c) => c.id).sort()).toEqual(["sam", "sam2"]);
    expect(findLikeReference("same as Sam Wu", clients)?.client?.id).toBe("sam2");
  });
  it("never the client the work is already for, and nothing when nobody is named", () => {
    expect(findLikeReference("like Rob", clients, "rob")).toBeNull();
    expect(findLikeReference("a strong full body program", clients)).toBeNull();
    expect(findLikeReference("like a boss", clients)).toBeNull();
  });
});

describe("what the AI is given as reference", () => {
  it("their notes, the coach's rules for them and an outline of their program, said to be a guide and not to be copied", () => {
    const block = referenceBlock("Rob", { notes: ["Cannot rotate: maximize rotation elsewhere"], rules: ["No barbell squats (for clients with back limits)"], outline: ["Week 1, Day 1 (Lower): Trap Bar Deadlift; Split Squat"] })!;
    expect(block).toContain("how this coach programs for Rob");
    expect(block).toContain("Do not copy it blindly");
    expect(block).toContain("The safety, injury and youth rules above always win");
    expect(block).toContain("Cannot rotate");
    expect(block).toContain("No barbell squats");
    expect(block).toContain("Week 1, Day 1 (Lower)");
    expect(referenceBlock("Rob", { notes: [], rules: [], outline: [] })).toBeNull();
  });
  it("the outline is short", () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ week: 1, day: i + 1, title: "Day", exercises: Array.from({ length: 12 }, (_, j) => `Ex ${j}`) }));
    const lines = outlineLines(days);
    expect(lines).toHaveLength(12);
    expect(lines[0].split(";")).toHaveLength(8);
  });
});

describe("it is a look, not a copy; private and inside one organization", () => {
  const ref = read("lib/reference-context.ts");
  it("reads only the coach's own client in the same organization, and writes nothing", () => {
    expect(ref).toContain("g.organization_id === orgId");
    expect(ref).toContain('.eq("role", "coach")');
    expect(ref).not.toContain(".insert(");
    expect(ref).not.toContain(".upsert(");
    expect(ref).not.toContain(".update(");
    expect(ref).not.toContain("athlete_notes");
    expect(ref).not.toContain("date_of_birth");
  });
  it("the day builder and the template picker take it, and the screens show one line with Cancel", () => {
    expect(read("app/api/ai/build-day/route.ts")).toContain("loadReferenceBlock(supabase, user.id, referenceId, groupId)");
    expect(read("app/api/ai/pick-template/route.ts")).toContain("loadReferenceBlock(supabase, user.id, referenceId,");
    expect(read("components/coach/desktop/ai-program-builder-box.tsx")).toContain("<LikeClientSuggestion");
    expect(read("components/coach/desktop/use-template-panel.tsx")).toContain("<LikeClientSuggestion");
    const ui = read("components/coach/desktop/like-client.tsx");
    expect(ui).toContain("Using how you program for {first} as a reference");
    expect(ui).toContain("Cancel");
    expect(ui).toContain("Which client?");
    expect(ui).not.toContain("clause");
  });
});
