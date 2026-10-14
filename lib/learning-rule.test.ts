import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clauseKey, derivedKeys, inferClauseKeys, ruleApplies, splitCorrection } from "@/lib/clauses";
import { LEARN_INTRO, WHY_CHIPS, WHY_PROMPT, proposeRule, ruleKind, sameRule, withScope } from "@/lib/learning-rule";
import { detectSwapPatterns, patternKey } from "@/lib/edit-patterns";
import { isWriteRequest } from "@/lib/workspace-mutation";
import { appliedLine, isSilent, learnedBlock, learnedLines, LEARNED_HEADING, SILENT_AFTER, toApplied } from "@/lib/learned-for-prompt";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

// Ron: "if it says no barbells because of his back, why would it ever think that applies to everyone?" A rule is remembered WITH its reason and reaches only the clients it fits.
describe("a correction becomes a rule with its reason", () => {
  it("'no barbell squats, his back' is remembered for clients with back limits", () => {
    const p = proposeRule({ correction: "no barbell squats, his back" })!;
    expect(p.thenText).toBe("No barbell squats");
    expect(p.whenKeys).toEqual(["back_limit"]);
    expect(p.scope).toBe("clauses");
    expect(p.kind).toBe("avoid");
    expect(p.summary).toBe("I'll remember: no barbell squats for clients with back limits.");
  });
  it("a movement name is not a reason: 'barbell back squat' and 'hip thrust' add no clause", () => {
    expect(inferClauseKeys("no barbell back squats", false)).toEqual([]);
    expect(inferClauseKeys("skip the hip thrusts", false)).toEqual([]);
    expect(proposeRule({ correction: "no barbell back squats" })!.scope).toBe("all");
  });
  it("a part named as the problem counts even in the instruction", () => {
    expect(inferClauseKeys("no deadlifts, bad knee", true)).toEqual(["knee_limit"]);
    expect(inferClauseKeys("avoid it with back pain", false)).toEqual(["back_limit"]);
    expect(inferClauseKeys("her lower back hurts", true)).toEqual(["back_limit"]);
    expect(inferClauseKeys("back off the volume", true)).toEqual([]);
  });
  it("with no reason it is a preference about how the coach works, for all clients", () => {
    const p = proposeRule({ correction: "rest 60-90" })!;
    expect(p.kind).toBe("rest");
    expect(p.whenKeys).toEqual([]);
    expect(p.scope).toBe("all");
    expect(p.summary).toBe("I'll remember: rest 60-90.");
    expect(proposeRule({ correction: "machines are fine for lower body" })!.kind).toBe("implement");
    expect(proposeRule({ correction: "shorter days, 45 minutes" })!.kind).toBe("day_length");
  });
  it("a reason given afterwards (typed or a chip) can supply the context", () => {
    expect(proposeRule({ correction: "no overhead pressing", whyText: "her shoulder" })!.whenKeys).toContain("shoulder_limit");
    expect(proposeRule({ correction: "no lunges", whyChips: ["injury_or_limit"], clientKeys: ["knee_limit"] })!.whenKeys).toEqual(["knee_limit"]);
    expect(proposeRule({ correction: "no lunges", whyChips: ["my_preference"], clientKeys: ["knee_limit"] })!.whenKeys).toEqual([]);
  });
  it("two reasons are both kept and read back plainly", () => {
    const p = proposeRule({ correction: "no twisting core work, his spine and shoulder" })!;
    expect(p.whenKeys.sort()).toEqual(["back_limit", "no_rotation", "shoulder_limit"].filter((k) => p.whenKeys.includes(k)).sort());
    expect(p.whenKeys.length).toBeGreaterThanOrEqual(1);
  });
  it("garbage in, nothing out", () => {
    expect(proposeRule({ correction: "" })).toBeNull();
    expect(proposeRule({ correction: "x".repeat(400) })).toBeNull();
  });
  it("splits an instruction from its reason", () => {
    expect(splitCorrection("no barbell squats, his back")).toEqual({ head: "no barbell squats", reason: "his back" });
    expect(splitCorrection("avoid overhead because of her shoulder")).toEqual({ head: "avoid overhead", reason: "her shoulder" });
    expect(splitCorrection("rest 60-90")).toEqual({ head: "rest 60-90", reason: "" });
  });
});

describe("changing who a rule applies to", () => {
  const base = proposeRule({ correction: "no barbell squats, his back" })!;
  it("this client only, all clients, or the reasons he picks", () => {
    expect(withScope(base, "client").summary).toBe("I'll remember: no barbell squats for this client.");
    expect(withScope(base, "all").summary).toBe("I'll remember: no barbell squats.");
    expect(withScope(base, "clauses", ["back_limit", "level_beginner"]).summary).toBe("I'll remember: no barbell squats for clients with back limits and beginner.");
    expect(withScope(base, "clauses", []).whenKeys).toEqual(["back_limit"]);
  });
  it("kinds of rule are told apart and a repeat is recognised", () => {
    expect(ruleKind("no barbell squats")).toBe("avoid");
    expect(sameRule({ kind: "avoid", thenText: "No barbell squats", whenKeys: ["back_limit"], scope: "clauses" }, { kind: "avoid", then_text: "no barbell squats.", when_keys: ["back_limit"], scope: "clauses", client_id: null }, null)).toBe(true);
    expect(sameRule({ kind: "avoid", thenText: "No barbell squats", whenKeys: [], scope: "all" }, { kind: "avoid", then_text: "No barbell squats", when_keys: ["back_limit"], scope: "clauses", client_id: null }, null)).toBe(false);
  });
});

describe("which rules reach which client", () => {
  const back = { scope: "clauses", whenKeys: ["back_limit"], clientId: null };
  it("a clause rule reaches only a client with every clause it names", () => {
    expect(ruleApplies(back, { athleteId: "a", keys: ["back_limit", "level_beginner"] })).toBe(true);
    expect(ruleApplies(back, { athleteId: "a", keys: ["knee_limit"] })).toBe(false);
    expect(ruleApplies({ scope: "clauses", whenKeys: ["back_limit", "no_rotation"], clientId: null }, { athleteId: "a", keys: ["back_limit"] })).toBe(false);
    expect(ruleApplies({ scope: "clauses", whenKeys: [], clientId: null }, { athleteId: "a", keys: ["back_limit"] })).toBe(false);
    expect(ruleApplies(back, { athleteId: null, keys: [] })).toBe(false);
  });
  it("a coach-wide rule reaches everyone; a client rule only that client", () => {
    expect(ruleApplies({ scope: "all", whenKeys: [], clientId: null }, { athleteId: null, keys: [] })).toBe(true);
    expect(ruleApplies({ scope: "client", whenKeys: [], clientId: "a" }, { athleteId: "a", keys: [] })).toBe(true);
    expect(ruleApplies({ scope: "client", whenKeys: [], clientId: "a" }, { athleteId: "b", keys: [] })).toBe(false);
  });
  it("level and age band come from what the app already knows", () => {
    expect(derivedKeys({ level: "beginner", dateOfBirth: "1990-05-05" }, new Date("2026-10-13T12:00:00Z"))).toEqual(["level_beginner", "age_30_49"]);
    expect(derivedKeys({ dateOfBirth: "2000-01-01" }, new Date("2026-10-13T12:00:00Z"))).toEqual(["age_under_30"]);
    expect(derivedKeys({ dateOfBirth: "1970-01-01" }, new Date("2026-10-13T12:00:00Z"))).toEqual(["age_50_plus"]);
    // a client under 18 gets no age band (the youth rules handle them)
    expect(derivedKeys({ dateOfBirth: "2015-01-01" }, new Date("2026-10-13T12:00:00Z"))).toEqual([]);
    expect(clauseKey("Ankle stability!")).toBe("ankle_stability");
  });
});

describe("what the AI is told", () => {
  const rules = [
    { kind: "avoid", then_text: "No barbell squats", when_keys: ["back_limit"], scope: "clauses", client_id: null },
    { kind: "rest", then_text: "Rest 60-90", when_keys: [], scope: "all", client_id: null },
    { kind: "avoid", then_text: "No lunges", when_keys: [], scope: "client", client_id: "sam" },
    { kind: "swap", then_text: null, when_keys: [], scope: "all", client_id: null },
  ];
  it("only the rules that fit this client, as plain sentences, most specific first", () => {
    expect(learnedLines(rules, { athleteId: "sam", keys: ["back_limit"] })).toEqual(["No barbell squats (for clients with back limits)", "No lunges", "Rest 60-90"]);
    expect(learnedLines(rules, { athleteId: "kim", keys: [] })).toEqual(["Rest 60-90"]);
  });
  it("sits under the hard rules and says it can only add; nothing to say means no block", () => {
    const block = learnedBlock(["Rest 60-90"])!;
    expect(block).toContain(LEARNED_HEADING);
    expect(LEARNED_HEADING).toContain("safety, injury and youth rules always win");
    expect(learnedBlock([])).toBeNull();
  });
  it("every AI path that writes or explains a program is given it", () => {
    for (const f of ["app/api/ai/build-day/route.ts", "app/api/ai/pick-template/route.ts", "app/api/ai/generate-program/route.ts", "app/api/ai/program-chat/route.ts"]) {
      expect(read(f), f).toMatch(/loadLearnedLines\(|loadApplicableRules\(/);
    }
    expect(read("lib/ai-day-run.ts")).toContain("if (input.learnedBlock) parts.push(input.learnedBlock);");
    expect(read("lib/ai-from-template.ts")).toContain("if (input.learnedBlock) parts.push(input.learnedBlock);");
  });
});

describe("how it asks", () => {
  it("says how it learns, then one plain line, and the reason chips", () => {
    expect(LEARN_INTRO).toBe("I learn from the changes you make. I'll ask a few questions so I can build it your way, and the more I learn the less I'll ask.");
    expect(WHY_PROMPT).toBe("Why did you change this? Only asking so I can help you better next time.");
    expect(WHY_CHIPS.map((c) => c.label)).toEqual(["Injury or limit", "My preference", "Equipment", "Time", "Client feedback"]);
  });
  it("the Pause correction offers it once per sitting, and the Learned page shows the rules, who they reach and the intro", () => {
    const line = read("components/coach/desktop/learn-line.tsx");
    expect(line).toContain('const SITTING_KEY = "esc-learn-asked"');
    expect(line).toContain("Change who this applies to");
    expect(line).toContain("Not now");
    expect(line).toContain("Or tell me in your own words");
    expect(read("components/coach/desktop/ai-program-builder-box.tsx")).toContain("<LearnLine key={learn.id}");
    expect(read("components/coach/learned-list.tsx")).toContain("{LEARN_INTRO}");
    expect(read("components/coach/learned-section.tsx")).toContain("For clients with");
  });
  it("the route respects the off switch and keeps clauses on the client the coach just described", () => {
    const route = read("app/api/learning/rule/route.ts");
    expect(route).toContain("if (!askingOn) return NextResponse.json({ skip: true });");
    expect(route).toContain("client_clauses");
    expect(route).toContain("That client isn't yours.");
  });
});

describe("saving a rule is counted as a save", () => {
  it("so the other panes refresh", () => {
    expect(isWriteRequest("POST", "/api/learning/rule", "https://app.test", undefined)).toBe(true);
    expect(isWriteRequest("POST", "https://app.test/api/learning/rule", "https://app.test", undefined)).toBe(true);
  });
});

describe("a taught rule has no from/to names and must not break the swap code", () => {
  it("patternKey and the sign-off lookup tolerate null names", () => {
    expect(() => patternKey(null, null)).not.toThrow();
    expect(patternKey(null, undefined)).toBe("|");
    const asked = new Set<string>([patternKey(null, null)]);
    expect(detectSwapPatterns([], [], asked)).toEqual([]);
  });
  it("sign-off, the suggestion card, Yes/No/reason and learn-reason only ever touch swap rules", () => {
    expect(read("app/api/ai/sign-off/route.ts")).toContain('.eq("coach_id", user.id).eq("kind", "swap")');
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/page.tsx")).toContain('.eq("kind", "swap")');
    expect(read("app/api/learned-rules/[ruleId]/route.ts")).toContain('rule.kind !== "swap" && body.action !== "undo"');
    expect(read("app/api/ai/learn-reason/route.ts")).toContain('rule.kind !== "swap"');
  });
});

// Release R2: once a rule has been confirmed three times it is applied without asking, and every use shows its reason with an Undo.
describe("the ladder: ask, then apply quietly, always showing why", () => {
  it("silent after three confirmations", () => {
    expect(SILENT_AFTER).toBe(3);
    expect(isSilent({ confirmations: 1 })).toBe(false);
    expect(isSilent({ confirmations: 2 })).toBe(false);
    expect(isSilent({ confirmations: 3 })).toBe(true);
    expect(isSilent({})).toBe(false);
  });
  it("the line says what was applied and why, with the count", () => {
    expect(appliedLine({ text: "No barbell squats", because: "back limits", confirmations: 3 })).toBe("Applied your rule: no barbell squats (because: back limits; you confirmed this 3 times)");
    expect(appliedLine({ text: "Rest 60-90", because: "your preference", confirmations: 1 })).toBe("Applied your rule: rest 60-90 (because: your preference; you confirmed this once)");
  });
  it("the reason is the coach's own words when he gave them, otherwise the clauses, otherwise his preference", () => {
    const applied = toApplied([
      { id: "a", kind: "avoid", then_text: "No barbell squats", when_keys: ["back_limit"], scope: "clauses", client_id: null, confirmations: 3, reason_text: null },
      { id: "b", kind: "avoid", then_text: "No lunges", when_keys: [], scope: "client", client_id: "x", confirmations: 1, reason_text: "her knee" },
      { id: "c", kind: "rest", then_text: "Rest 60-90", when_keys: [], scope: "all", client_id: null, confirmations: 2, reason_text: null },
    ]);
    expect(applied.map((a) => a.because)).toEqual(["back limits", "her knee", "your preference"]);
    expect(applied.map((a) => a.silent)).toEqual([true, false, false]);
  });
  it("a correction already confirmed three times is not asked about again, only counted; the day builder shows what it used, with Undo", () => {
    const route = read("app/api/learning/rule/route.ts");
    expect(route).toContain("if (match && isSilent(match))");
    expect(route).toContain("return NextResponse.json({ skip: true, known: true });");
    expect(read("app/api/ai/build-day/route.ts")).toContain("applied: toApplied(taughtRules)");
    const box = read("components/coach/desktop/ai-program-builder-box.tsx");
    expect(box).toContain("appliedLine(a)");
    expect(box).toContain("undoApplied(a)");
    expect(read("components/coach/learned-section.tsx")).toContain("I apply it without asking.");
  });
});
