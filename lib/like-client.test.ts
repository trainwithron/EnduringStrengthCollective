import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findLikeReference, namedClausesIn } from "@/lib/like-client";
import { cleanExtraKeys, learnedLines } from "@/lib/learned-for-prompt";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const clients = [
  { id: "rob", fullName: "Rob Derrick" },
  { id: "sam", fullName: "Sam Rivers" },
  { id: "sam2", fullName: "Sam Wu" },
  { id: "kim", fullName: "Kim Lee" },
];

// Ron: "similar to Rob's bad back, we need to program around it" / "same protocols as Rob Derrick" / "this client has a no rotation clause".
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

describe("a clause named directly", () => {
  it("reads the clause the coach calls out", () => {
    expect(namedClausesIn("this client has a no rotation clause")).toEqual(["no_rotation"]);
    expect(namedClausesIn("add the back limits clause and a limited overhead range clause")).toEqual(["back_limit", "overhead_limit"]);
    expect(namedClausesIn("no rotation exercises today")).toEqual([]);
  });
});

describe("using them for one request", () => {
  const rules = [
    { kind: "avoid", then_text: "No barbell squats", when_keys: ["back_limit"], scope: "clauses", client_id: null },
    { kind: "avoid", then_text: "No twisting core work", when_keys: ["no_rotation"], scope: "clauses", client_id: null },
  ];
  it("the borrowed clauses reach the AI like the client's own", () => {
    expect(learnedLines(rules, { athleteId: null, keys: [] })).toEqual([]);
    expect(learnedLines(rules, { athleteId: null, keys: ["back_limit"] })).toEqual(["No barbell squats (for clients with back limits)"]);
  });
  it("only plain clause slugs are accepted from the screen", () => {
    expect(cleanExtraKeys(["back_limit", "no rotation", "x".repeat(50), 3, "ok_1"])).toEqual(["back_limit", "ok_1"]);
    expect(cleanExtraKeys("nope")).toEqual([]);
  });
  it("the day builder and the template picker take them, and the screens offer them", () => {
    expect(read("app/api/ai/build-day/route.ts")).toContain("cleanExtraKeys(body.extraClauseKeys)");
    expect(read("app/api/ai/pick-template/route.ts")).toContain("cleanExtraKeys(body.extraClauseKeys)");
    expect(read("components/coach/desktop/ai-program-builder-box.tsx")).toContain("<LikeClientSuggestion");
    expect(read("components/coach/desktop/use-template-panel.tsx")).toContain("<LikeClientSuggestion");
  });
});

describe("the copy is a starting point, private and inside one organization", () => {
  const route = read("app/api/learning/protocol/route.ts");
  it("reads only the coach's own clauses, only inside the same organization, and copies by name", () => {
    expect(route).toContain('.eq("coach_id", user.id).eq("athlete_id", referenceId)');
    expect(route).toContain("g.organization_id === orgId");
    expect(route).toContain('seat?.role !== "coach"');
    expect(route).toContain("That client isn't yours.");
    expect(route).not.toContain("athlete_notes");
    expect(route).not.toContain("par_q");
    expect(route).not.toContain("date_of_birth");
  });
  it("the preview offers Use and Cancel with a tick per clause, says nothing flows back, and offers the profile once", () => {
    const ui = read("components/coach/desktop/like-client.tsx");
    for (const s of ["as a starting point", "Use", "Cancel", "edits here never flow back", "to this client&apos;s profile?", "Which client?", "Stop using these"]) expect(ui, s).toContain(s);
  });
});
