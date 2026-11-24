import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNewRequest, parseBuildRequest } from "@/lib/ai-day-request";
import { mobilityDayPlan, mobilityDaysWanted, namedMobilityDays, planRole } from "@/lib/ai-day-rules";
import {
  decodeMsg,
  encodeMsg,
  isWhyQuestion,
  messageIntent,
  missingQuestions,
  planSummary,
  PLAN_QUESTIONS,
  lastRequestIn,
  rebuildRequest,
  rebuildSlots,
  rebuildTargetFrom,
  withKeep,
  replacesLine,
  withAnswers,
  type ChatMsg,
} from "@/lib/builder-chat";

// The AI Program Builder as one chat (Ron, Nov 24; reports/program-builder-chat-mockup.html). The pure parts here; the chat is components/coach/desktop/program-builder-chat.tsx.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const chat = read("components/coach/desktop/program-builder-chat.tsx");
const none = { existing: [], trainingDaysCount: null, trainingDays: null };
// Ron's two sentences from Nov 24
const RON = "5 day split 3 Days full body to Mobility days in between we will do a focus on she wants a bigger butt toned arms tone core strong back just generally aesthetic driven";
const RON_2 = "5 day split 3 day a week full body workouts then 2 days a week will be Mobility exercises she wants a strong core bigger butt toned arms and just generally aesthetic driven";

describe("the plan comes first, in one line, from the builder's own parsers", () => {
  it("Ron's request: 3 full body days and 2 mobility days between them", () => {
    for (const said of [RON, RON_2]) {
      const p = planSummary(said, none);
      expect(p.daysInWeek).toBe(5);
      expect(p.mobilityDays).toEqual([2, 4]);
      expect(p.line).toBe("5 days a week: full body days 1, 3 and 5, mobility days 2 and 4.");
    }
  });
  it("weekday names when the program's schedule has that many days, and the weeks when said", () => {
    expect(planSummary(`${RON_2}, 4 weeks`, { existing: [], trainingDaysCount: 5, trainingDays: [1, 2, 3, 4, 5] }).line).toBe("5 days a week: full body Mon, Wed and Fri, mobility Tue and Thu. 4 weeks.");
    expect(planSummary("upper lower 4 days a week, 6 weeks", none).line).toBe("4 days a week. 6 weeks.");
    // a count the parsers cannot read shows in the plan before anything is built (no number: the 3-day default)
    expect(planSummary("upper lower for a beginner", none).line).toBe("3 days a week.");
    expect(planSummary("4 day upper lower", none).line).toBe("4 days a week.");
  });
  it("the plan turn is what a new request gets; Build it is what starts building", () => {
    const send = chat.slice(chat.indexOf("async function send("));
    expect(send).toContain("planTurn(pendingPlan.current && !isNewRequest(said) ? withAnswers(pendingPlan.current.request, [said]) : said);");
    const go = chat.slice(chat.indexOf("async function goFromPlan("), chat.indexOf("// ---- answers ----"));
    expect(go).toContain("startRun(said);");
    expect(chat.slice(chat.indexOf("function planTurn("), chat.indexOf("async function goFromPlan("))).not.toContain("startRun(");
  });
});

describe("at most 3 fixed questions, only for what the words leave out", () => {
  it("Ron's request asks weeks, session length and equipment, with tap answers", () => {
    expect(missingQuestions(RON_2).map((q) => q.key)).toEqual(["weeks", "session", "equipment"]);
    expect(PLAN_QUESTIONS.weeks.options.map((o) => o.label)).toEqual(["Just week 1", "4 weeks", "6 weeks"]);
  });
  it("only the missing ones; none when all are given", () => {
    expect(missingQuestions(`${RON_2}, 4 weeks`).map((q) => q.key)).toEqual(["session", "equipment"]);
    expect(missingQuestions(`${RON_2}, 60 minute sessions`).map((q) => q.key)).toEqual(["weeks", "equipment"]);
    expect(missingQuestions(`${RON_2}, 4 weeks, 60 minute sessions, full gym`)).toEqual([]);
    expect(missingQuestions("finish the week, an hour each, dumbbells only")).toEqual([]);
  });
  it("a tapped or typed answer is read like typed words", () => {
    const said = withAnswers(RON_2, ["4 weeks", "60 minute sessions", ""]);
    expect(said).toBe(`${RON_2}. 4 weeks. 60 minute sessions.`);
    expect(planSummary(said, none).weeks).toBe(4);
    expect(missingQuestions(said).map((q) => q.key)).toEqual(["equipment"]);
  });
  it("the questions are fixed words (no made-up questions)", () => {
    expect(chat).toContain("questions: rebuild ? [] : missingQuestions(said),");
    for (const q of Object.values(PLAN_QUESTIONS)) expect(q.ask).toMatch(/^(How many weeks\?|How long can each session be\?|What equipment\?)$/);
  });
});

describe("one thread: build, ask why, a change shown then done, and the learning question", () => {
  it("each message goes where it should", () => {
    expect(messageIntent(RON_2, { phase: "idle", hasBuilt: false, editOpen: false })).toBe("request");
    expect(messageIntent("why two presses on day 1?", { phase: "building", hasBuilt: true, editOpen: false })).toBe("why");
    expect(messageIntent("less volume on the legs", { phase: "building", hasBuilt: true, editOpen: false })).toBe("correction");
    expect(messageIntent("swap the squats for leg press on every week", { phase: "done", hasBuilt: true, editOpen: false })).toBe("edit");
    expect(messageIntent("every week", { phase: "done", hasBuilt: true, editOpen: true })).toBe("edit");
    expect(isWhyQuestion("Why the hip thrusts first")).toBe(true);
    expect(isWhyQuestion("add more glute work")).toBe(false);
  });
  it("building, the warning once, the why-answer, the preview and its Do it, then the learning question, all as messages in the same list", () => {
    expect(chat).toContain('setProgress([...progressItems.current.filter((i) => i.state === "done"), { week: slot.week, day: slot.day, title, state: "done" }], null);');
    expect(chat).toContain('push({ kind: "warn", lines: fresh.slice(-3) });');
    expect(chat).toContain('push({ kind: "answer", question, text: data.answer as string, change:');
    expect(chat).toContain('push({ kind: "preview", lines, skipped,');
    const apply = chat.slice(chat.indexOf("async function applyPreview("), chat.indexOf("function takeChange("));
    expect(apply.indexOf('mode: "apply"')).toBeLessThan(apply.indexOf('push({ kind: "learn", correction: instruction })'));
    expect(chat).toContain('{m.kind === "learn" && !m.historic && <LearnLine');
    // a change while building is asked about too, once per change
    expect(chat.slice(chat.indexOf("async function resumeNow("), chat.indexOf("async function resumeButton("))).toContain('push({ kind: "learn", correction: said });');
  });
  it("plain-word errors, never a code or a stack", () => {
    for (const s of ["Couldn't build that day. Try again, or say it another way.", "Couldn't answer that. Try again.", "Couldn't work out those changes. Try saying it another way.", "Couldn't save those changes, so nothing was changed. Try Do it again."]) expect(chat).toContain(s);
  });
});

describe("the thread is kept with the program and comes back after a reload", () => {
  const thread: ChatMsg[] = [
    { id: "1", kind: "coach", text: RON_2 },
    { id: "2", kind: "plan", request: RON_2, line: "5 days a week: full body days 1, 3 and 5, mobility days 2 and 4.", sheetLine: null, questions: missingQuestions(RON_2), rebuild: null },
    { id: "3", kind: "progress", items: [{ week: 1, day: 1, title: "Full body A", state: "done" }], ended: "done" },
    { id: "4", kind: "warn", lines: ["Week 1 has 4 training days, but your description asked for 5 a week."] },
    { id: "5", kind: "answer", question: "why two presses?", text: "Volume for the arms.", change: "swap the second press for a row" },
    { id: "6", kind: "preview", lines: ["Day 1: swap Incline Press for Seated Row"], skipped: [], flags: [], plan: [{ workoutId: "w" }] },
    { id: "7", kind: "say", text: "Done. 1 day changed." },
  ];
  it("what is kept reads back the same, as history (no live buttons: an old preview is never applied again)", () => {
    for (const m of thread) {
      const row = encodeMsg(m)!;
      expect(row.role).toBe(m.kind === "coach" ? "coach" : "assistant");
      const back = decodeMsg(m.id, row.role, row.body)!;
      expect(back.historic).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { historic, done, ...same } = back;
      expect(same).toEqual(m);
    }
    expect(decodeMsg("6", "assistant", encodeMsg(thread[5])!.body)!.done).toBe(true);
  });
  it("the one-off questions are not kept, and an older program-chat answer reads as plain words", () => {
    expect(encodeMsg({ id: "x", kind: "learn", correction: "less volume" })).toBeNull();
    expect(encodeMsg({ id: "x", kind: "import", text: "Day 1\nSquat 3x5" })).toBeNull();
    expect(encodeMsg({ id: "x", kind: "offer_week", week: 2 })).toBeNull();
    expect(decodeMsg("o", "assistant", "Sure, I made Day 2 lighter.")).toEqual({ id: "o", kind: "say", text: "Sure, I made Day 2 lighter.", historic: true });
    expect(decodeMsg("o", "assistant", '{"v":1,"kind":"learn","correction":"x"}')!.kind).toBe("say");
  });
  it("the chat finds the program's own thread, reads it back in order on open, and saves each message to it; a failed save says so once", () => {
    expect(chat).toContain('.from("coach_chat_threads").select("id").eq("coach_id", coachId.current).eq("program_id", programId)');
    expect(chat).toContain('.insert({ coach_id: coachId.current, program_id: programId })');
    // opening the page only looks it up; one is made with the first message kept
    const load = chat.slice(chat.indexOf("useEffect(() => {"), chat.indexOf("// The client's goal sheet"));
    expect(load).toContain("await findThread()");
    expect(load).not.toContain("ensureThread");
    expect(chat.slice(chat.indexOf("function findThread("), chat.indexOf("function ensureThread("))).not.toContain(".insert(");
    expect(chat).toContain('.from("coach_chat_messages").select("id, role, body").eq("thread_id", id).order("created_at", { ascending: true })');
    expect(chat).toContain("decodeMsg(r.id, r.role, r.body)");
    expect(chat).toContain('.from("coach_chat_messages").insert({ thread_id: id, coach_id: coachId.current, role: row.role, body: row.body })');
    expect(chat).toContain("This conversation isn't saving right now, so it won't be here next time. The program itself is saved.");
    expect(chat).toContain("if (!touched.ok && !saveFailShown.current) {");
  });
});

describe("rebuild asks first, then replaces the days; Not now changes nothing", () => {
  it("what counts as a rebuild, and what it replaces", () => {
    expect(rebuildTargetFrom("rebuild week 1")).toEqual({ week: 1, day: null });
    expect(rebuildTargetFrom("redo week 2 with more glutes")).toEqual({ week: 2, day: null });
    expect(rebuildTargetFrom("start over")).toEqual({ week: 1, day: null });
    expect(rebuildTargetFrom("scrap it")).toEqual({ week: 1, day: null });
    expect(rebuildTargetFrom("redo day 2")).toEqual({ week: 1, day: 2 });
    expect(rebuildTargetFrom("week 3 redo day 4")).toEqual({ week: 3, day: 4 });
    // a change to one exercise is not a rebuild
    expect(rebuildTargetFrom("redo the squats lighter")).toBeNull();
    expect(rebuildTargetFrom("redo it with less volume")).toBeNull();
    expect(rebuildTargetFrom("less volume")).toBeNull();
    expect(replacesLine({ week: 1, day: null }, 5)).toBe("This replaces Week 1's 5 days.");
    expect(replacesLine({ week: 1, day: 2 }, 5)).toBe("This replaces Week 1, Day 2.");
    expect(rebuildSlots({ week: 1, day: null }, 5)).toEqual([1, 2, 3, 4, 5].map((day) => ({ week: 1, day })));
    expect(rebuildSlots({ week: 2, day: 3 }, 5)).toEqual([{ week: 2, day: 3 }]);
  });
  it("only once something is built; before that it is a request like any other", () => {
    expect(messageIntent("rebuild week 1", { phase: "done", hasBuilt: true, editOpen: false })).toBe("rebuild");
    expect(messageIntent("rebuild week 1", { phase: "paused", hasBuilt: true, editOpen: false })).toBe("rebuild");
    expect(messageIntent("rebuild week 1", { phase: "idle", hasBuilt: false, editOpen: false })).toBe("request");
  });
  it("the message only shows the plan and the confirm; the days are cleared only from its Do it, then built again in order", () => {
    const send = chat.slice(chat.indexOf("async function send("), chat.indexOf("const building = phase"));
    expect(send).toContain('const target = intent === "rebuild" ? rebuildTargetFrom(said) : null;\n      if (target) {\n        rebuildTurn(said, target);\n        return;');
    expect(send).not.toContain(".delete(");
    expect(chat).toContain("{msg.rebuild.replaces} Rebuild?");
    expect(chat).toContain('{msg.rebuild ? "Do it" : "Build it"}');
    const go = chat.slice(chat.indexOf("async function goFromPlan("), chat.indexOf("// ---- answers ----"));
    expect(go.indexOf("if (!msg.rebuild) {")).toBeLessThan(go.indexOf(".delete("));
    expect(go.indexOf(".delete(")).toBeLessThan(go.indexOf("startRun(said, rebuildSlots(target, d), kept ? [kept] : []);"));
    // a delete that fails or removes nothing stops before anything is built
    expect(go).toContain('{ expectRows: true });\n        if (!cleared.ok) {\n          say("Couldn\'t clear those days, so nothing was changed. Try again.", "error");\n          return;');
  });
  it("Not now closes the plan and says nothing was changed: no write, no build", () => {
    const at = chat.indexOf("onNotNow={() => {");
    const notNow = chat.slice(at, chat.indexOf("}}", at));
    expect(notNow).toContain('say("Okay, nothing built or changed.");');
    for (const w of ["fetch(", ".delete(", "startRun(", "goFromPlan("]) expect(notNow).not.toContain(w);
  });
  it("a why-answer that offers a rebuild goes to the same confirm", () => {
    const take = chat.slice(chat.indexOf("function takeChange("), chat.indexOf("// ---- one send ----"));
    expect(take).toContain("const target = rebuildTargetFrom(msg.change);\n    if (target && hasBuilt()) {\n      rebuildTurn(msg.change, target);");
  });
});

describe("the layout: chat left and program right on a wide screen, full width on a phone with the composer kept above the tab bar", () => {
  it("is sized for both", () => {
    const builder = read("components/coach/desktop/program-builder-desktop.tsx");
    expect(builder).toContain("@5xl:grid @5xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]");
    expect(chat).toContain("sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] lg:bottom-0");
    expect(chat).toContain("min-w-0");
    // 16px text on a phone (no zoom on focus), 44px targets
    expect(chat).toContain("text-base sm:text-sm");
    expect(chat).toContain("min-h-11");
  });
});

describe("review of b60a390f: a rebuild keeps the program's request", () => {
  // what build-day reads for one day: the request and every change, as one text (app/api/ai/build-day/route.ts `sayings`)
  const roleOf = (request: string, keep: string[], day: number) => {
    const sayings = `${request}. ${keep.join(". ")}`;
    const d = parseBuildRequest(sayings).daysPerWeek ?? 3;
    const named = namedMobilityDays(sayings, d, null);
    const m = mobilityDaysWanted(sayings, d) ?? (named ? named.length : null);
    return m != null ? planRole(day, mobilityDayPlan(d, m, named)) : "free";
  };
  it("rebuild week 1 after Ron's request: days 1, 3 and 5 stay full body, 2 and 4 mobility, and the plan line says so", () => {
    const r = rebuildRequest(RON_2, "rebuild week 1");
    expect(r).toEqual({ request: RON_2, keep: "rebuild week 1" });
    expect(planSummary(withKeep(r.request, r.keep), none).line).toBe("5 days a week: full body days 1, 3 and 5, mobility days 2 and 4.");
    expect([1, 2, 3, 4, 5].map((day) => roleOf(r.request, [r.keep!], day))).toEqual(["must_not", "must", "must_not", "must", "must_not"]);
  });
  it('"redo day 2" keeps day 2 a mobility day', () => {
    const r = rebuildRequest(RON_2, "redo day 2");
    expect(r.keep).toBe("redo day 2");
    expect(roleOf(r.request, [r.keep!], 2)).toBe("must");
    expect(rebuildSlots(rebuildTargetFrom("redo day 2")!, 5)).toEqual([{ week: 1, day: 2 }]);
  });
  it('"redo week 2 with more glutes" keeps the split and adds the glutes as a change', () => {
    const r = rebuildRequest(RON_2, "redo week 2 with more glutes");
    expect(r).toEqual({ request: RON_2, keep: "redo week 2 with more glutes" });
    expect(planSummary(withKeep(r.request, r.keep), none).mobilityDays).toEqual([2, 4]);
    expect(withKeep(r.request, r.keep)).toContain("more glutes");
  });
  it("a rebuild that is a request in its own right, or with nothing to keep, starts from its own words", () => {
    expect(rebuildRequest(RON_2, "rebuild week 1 as a 4 day upper lower")).toEqual({ request: "rebuild week 1 as a 4 day upper lower", keep: null });
    expect(rebuildRequest(null, "rebuild week 1")).toEqual({ request: "rebuild week 1", keep: null });
    expect(rebuildRequest("  ", "start over")).toEqual({ request: "start over", keep: null });
  });
  it("after a reload the request comes from the thread: the newest run's words (with its tapped answers), else the newest plan's", () => {
    const plan = { id: "p", kind: "plan" as const, request: RON_2, line: "", sheetLine: null, questions: [], rebuild: null };
    const run = { id: "r", kind: "progress" as const, items: [], ended: "done" as const, request: `${RON_2}. 4 weeks.` };
    expect(lastRequestIn([plan])).toBe(RON_2);
    expect(lastRequestIn([plan, run, { id: "s", kind: "say", text: "Done." }])).toBe(`${RON_2}. 4 weeks.`);
    expect(lastRequestIn([{ id: "c", kind: "coach", text: "hi" }])).toBeNull();
    // the run's words are kept with its progress, and read back
    const back = decodeMsg("r", "assistant", encodeMsg(run)!.body)!;
    expect(lastRequestIn([back])).toBe(`${RON_2}. 4 weeks.`);
  });
  it("the chat uses them: the rebuild plan reads the request with the rebuild words, and Do it sends the words along as a change", () => {
    const turn = chat.slice(chat.indexOf("function rebuildTurn("), chat.indexOf("async function goFromPlan("));
    expect(turn).toContain("rebuildRequest(request.current || lastRequestIn(msgsRef.current), said)");
    expect(turn).toContain("planTurn(r.request, target, r.keep);");
    expect(chat).toContain("const summary = planSummary(withKeep(said, keep),");
    expect(chat).toContain("said: keep } : null,");
    expect(chat).toContain('push({ kind: "progress", items, ended, request: said })');
  });
});

describe("review of b60a390f: a new request typed while a plan is open replaces it", () => {
  it('"actually make it a 4 day upper lower" is a new plan with 4 days; "60 minutes, bands only" answers the open one', () => {
    expect(isNewRequest("actually make it a 4 day upper lower")).toBe(true);
    expect(messageIntent("actually make it a 4 day upper lower", { phase: "idle", hasBuilt: false, editOpen: false })).toBe("request");
    expect(planSummary("actually make it a 4 day upper lower", none).line).toBe("4 days a week.");
    expect(isNewRequest("60 minutes, bands only")).toBe(false);
    // planTurn closes the open plan before it shows the new one
    expect(chat.slice(chat.indexOf("function planTurn("), chat.indexOf("function rebuildTurn("))).toContain("if (pendingPlan.current) patch(pendingPlan.current.id, { done: true });");
  });
});

describe("review of b60a390f: the thread reads back in the order it was written", () => {
  it("saves run one after another; every kept message goes through the chain", () => {
    expect(chat).toContain("saveChain.current = saveChain.current.then(() => save(m)).catch(() => {});");
    expect(chat).toContain('if (KEPT_KINDS.has(msg.kind) && msg.kind !== "progress") keep(msg);');
    expect(chat).toContain('keep({ id, kind: "progress", items, ended, request: said });');
    // nothing saves around the chain
    expect(chat.split("void save(")).toHaveLength(1);
    expect(chat.split("save(m)")).toHaveLength(2);
  });
  it("in order: a chain of slow and fast saves lands in the order they were started, and read back the same", async () => {
    const rows: string[] = [];
    let chain: Promise<void> = Promise.resolve();
    const save = (id: string, ms: number) => new Promise<void>((done) => setTimeout(() => { rows.push(id); done(); }, ms));
    for (const [id, ms] of [["coach", 30], ["plan", 1], ["say", 10]] as const) chain = chain.then(() => save(id, ms)).catch(() => {});
    await chain;
    expect(rows).toEqual(["coach", "plan", "say"]);
    expect(chat).toContain('.order("created_at", { ascending: true })');
  });
});
