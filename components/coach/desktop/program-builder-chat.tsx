"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { readAiJson } from "@/lib/ai-fetch";
import { checked } from "@/lib/checked-write";
import { FOLLOWED_PROGRAM_MESSAGE, readProgramIsFollowed } from "@/lib/ai-live-program";
import { BUILDER_ONE_WORKOUT_SELECT, mapWorkoutRowToBuilderDay } from "@/lib/program-builder-data";
import { headersOfWorkouts } from "@/lib/section-headers";
import { MicButton, stopAllMics } from "@/components/shared/mic-button";
import { ProgramImportLauncher, ProgramImportPanel } from "@/components/coach/desktop/program-import-launcher";
import { TemplateSuggestion } from "@/components/coach/desktop/template-suggestion";
import { LearnLine } from "@/components/coach/desktop/learn-line";
import { LikeClientSuggestion } from "@/components/coach/desktop/like-client";
import { PastAiNotes } from "@/components/coach/desktop/past-ai-notes";
import { ProgrammingSpotterPanel } from "@/components/coach/desktop/programming-spotter-panel";
import type { SpotterFlag } from "@/lib/programming-spotter-gather";
import { MAX_KEPT_LINES } from "@/lib/builder-spotter";
import { appliedLine, type AppliedRule } from "@/lib/learned-for-prompt";
import { isFreshStart, isNewRequest, parseBuildRequest, planSlots, replanQueue, scopeLimitFrom, fixTargetFrom, weekDaysFor } from "@/lib/ai-day-request";
import { mergeFlags } from "@/lib/constraint-scan";
import { WHICH_WEEKS_QUESTION, isYes, parseWeekRange, type PlannedDay, type WeekRange } from "@/lib/ai-week-edit";
import { EXPLAIN_MAX_EXCHANGES, type Exchange } from "@/lib/explain-program";
import type { DaySlot } from "@/lib/ai-day-slots";
import type { BuilderDay } from "@/lib/types";
import type { DemoRow } from "@/lib/exercise-demo";
import {
  decodeMsg,
  encodeMsg,
  KEPT_KINDS,
  lastRequestIn,
  rebuildRequest,
  withKeep,
  messageIntent,
  missingQuestions,
  planSummary,
  rebuildSlots,
  rebuildTargetFrom,
  replacesLine,
  withAnswers,
  type ChatMsg,
  type ProgressItem,
  type RebuildTarget,
} from "@/lib/builder-chat";

type Phase = "idle" | "building" | "paused" | "done";
type NewMsg = ChatMsg extends infer T ? (T extends ChatMsg ? Omit<T, "id"> : never) : never;
const COULDNT = "Couldn't build that day. Try again, or say it another way.";
const RANGE_CHIPS: { label: string; range: WeekRange }[] = [
  { label: "Every week", range: { kind: "all" } },
  { label: "From week 2 on", range: { kind: "weeks", from: 2, to: null } },
  { label: "Just week 1", range: { kind: "weeks", from: 1, to: 1 } },
];

// The AI Program Builder as ONE conversation (Ron, Nov 24; reports/program-builder-chat-mockup.html). It replaces the AI box (Ask / Pause / Resume / Continue), "What you asked
// for" and "Ask why", the "Why did you change this?" line and the separate program chat. Underneath it is the same building as before: one day at a time through
// /api/ai/build-day (the run token, youth, injury and library rules, the constraint scan, the day-count and mobility-day fixes), changes through /api/ai/edit-weeks (a preview
// first, nothing written until "Do it"), answers through /api/ai/explain-program, the learning question through /api/learning/rule. New here:
//  * a plan-first turn: the plan in one line from the same parsers the builder uses (so a misheard "to mobility days" shows before anything is built), the client's goal sheet,
//    and at most 3 tap questions (weeks, session length, equipment) only when the words do not say them;
//  * "rebuild week 1" / "redo day 2": the plan and "This replaces ...", and nothing is cleared until "Do it";
//  * a why-answer that offers a change leads straight to that change's preview;
//  * the conversation is kept with the program (coach_chat_threads / messages with its program_id) and comes back when the page is opened again.
// The mic stops on every send and every tap that sends. Coach-only: nothing reaches the client until the program is assigned.
export function ProgramBuilderChat({
  programId,
  groupId,
  athleteId = null,
  days,
  trainingDays,
  demoLibrary,
  exerciseTierByName,
  onDay,
  orgProgram = false,
  spotterNotes = null,
}: {
  programId: string;
  groupId: string;
  athleteId?: string | null;
  days: BuilderDay[];
  trainingDays: number[] | null;
  demoLibrary: DemoRow[];
  exerciseTierByName: Record<string, "A" | "B" | "C" | null>;
  onDay: (day: BuilderDay) => void;
  orgProgram?: boolean;
  // The Spotter's notes on this program, when they show here instead of the panel (the program was made in this chat); null when the panel shows them.
  spotterNotes?: SpotterFlag[] | null;
}) {
  const router = useRouter();
  const trainingDaysCount = trainingDays && trainingDays.length > 0 ? trainingDays.length : null;
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [composer, setComposer] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState<null | "why" | "preview" | "apply" | "rebuild">(null);
  const [applied, setApplied] = useState<AppliedRule[]>([]);
  const [importText, setImportText] = useState<string | null>(null);
  const [sheetLine, setSheetLine] = useState<string | null>(null);
  const inFlight = useRef(false);
  const threadEl = useRef<HTMLDivElement | null>(null);

  // ---- the thread kept with the program ----
  const coachId = useRef<string | null>(null);
  const threadId = useRef<Promise<string | null> | null>(null);
  const loaded = useRef(false);
  const saveFailShown = useRef(false);
  // The program's thread, looked up once (opening the page never makes one); made with the first message kept.
  const found = useRef<Promise<string | null> | null>(null);
  function findThread(): Promise<string | null> {
    if (found.current) return found.current;
    found.current = (async () => {
      const supabase = createBrowserClient();
      if (!coachId.current) coachId.current = (await supabase.auth.getUser()).data.user?.id ?? null;
      if (!coachId.current) return null;
      const { data } = await supabase.from("coach_chat_threads").select("id").eq("coach_id", coachId.current).eq("program_id", programId).order("created_at", { ascending: true }).limit(1).maybeSingle();
      return (data?.id as string | undefined) ?? null;
    })().catch(() => null);
    return found.current;
  }
  function ensureThread(): Promise<string | null> {
    if (threadId.current) return threadId.current;
    threadId.current = (async () => {
      const existing = await findThread();
      if (existing) return existing;
      if (!coachId.current) return null;
      const { data: made } = await createBrowserClient().from("coach_chat_threads").insert({ coach_id: coachId.current, program_id: programId }).select("id").single();
      return (made?.id as string | undefined) ?? null;
    })().catch(() => null);
    // a failed make is tried again with the next message
    void threadId.current.then((id) => {
      if (!id) threadId.current = null;
    });
    return threadId.current;
  }
  async function save(m: ChatMsg) {
    const row = encodeMsg(m);
    if (!row) return;
    const id = await ensureThread();
    const supabase = createBrowserClient();
    const kept = id && coachId.current ? await checked(supabase.from("coach_chat_messages").insert({ thread_id: id, coach_id: coachId.current, role: row.role, body: row.body })) : { ok: false };
    // the thread's last message time is what keeps it (threads idle for 90 days are cleared)
    const touched = kept.ok && id ? await checked(supabase.from("coach_chat_threads").update({ last_message_at: new Date().toISOString() }).eq("id", id)) : kept;
    if (!touched.ok && !saveFailShown.current) {
      saveFailShown.current = true;
      setMsgs((prev) => [...prev, { id: newId(), kind: "say", text: "This conversation isn't saving right now, so it won't be here next time. The program itself is saved.", tone: "error" }]);
    }
  }
  const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  // Saves go one after another, so the thread reads back in the order it was written (review of b60a390f).
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  function keep(m: ChatMsg) {
    saveChain.current = saveChain.current.then(() => save(m)).catch(() => {});
  }
  // A message on screen; kept with the program at once, except a run's progress, which is kept when the run stops (done or paused).
  function push(m: NewMsg): string {
    const msg = { ...m, id: newId() } as ChatMsg;
    setMsgs((prev) => [...prev, msg]);
    if (KEPT_KINDS.has(msg.kind) && msg.kind !== "progress") keep(msg);
    return msg.id;
  }
  function patch(id: string, change: Partial<ChatMsg>) {
    setMsgs((prev) => prev.map((m) => (m.id === id ? ({ ...m, ...change } as ChatMsg) : m)));
  }
  const say = (text: string, tone: "info" | "error" = "info") => push({ kind: "say", text, tone });

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      const supabase = createBrowserClient();
      const id = await findThread();
      if (id) {
        const { data } = await supabase.from("coach_chat_messages").select("id, role, body").eq("thread_id", id).order("created_at", { ascending: true }).limit(200);
        const back = ((data ?? []) as { id: string; role: string; body: string }[]).map((r) => decodeMsg(r.id, r.role, r.body)).filter((m): m is ChatMsg => m !== null);
        if (back.length > 0) setMsgs((prev) => [...back, ...prev]);
      }
      // The client's goal sheet, read first (it says how many days they can realistically train, and what got in the way before).
      if (athleteId) {
        const [{ data: sheet }, { data: who }] = await Promise.all([
          supabase.from("client_goal_sheets").select("days_per_week, obstacles").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle(),
          supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle(),
        ]);
        const first = ((who?.full_name as string | null) ?? "").trim().split(/\s+/)[0] || "The client";
        const parts: string[] = [];
        if (sheet?.days_per_week) parts.push(`${sheet.days_per_week} days a week is realistic`);
        const obstacles = ((sheet?.obstacles as string | null) ?? "").replace(/\s+/g, " ").trim();
        if (obstacles) parts.push(`what got in the way before: "${obstacles.length > 120 ? `${obstacles.slice(0, 117)}...` : obstacles}"`);
        if (parts.length > 0) setSheetLine(`${first}'s goal sheet: ${parts.join("; ")}.`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    threadEl.current?.scrollTo({ top: threadEl.current.scrollHeight });
  }, [msgs]);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;

  // ---- building (the same run as the old box) ----
  const daysRef = useRef(days);
  daysRef.current = days;
  const existingNow = () => daysRef.current.map((d) => ({ week: d.weekNumber, day: d.dayIndex, hasExercises: d.items.some((i) => i.kind === "exercise") }));
  const hasBuilt = () => daysRef.current.some((d) => d.items.some((i) => i.kind === "exercise"));
  const queue = useRef<DaySlot[]>([]);
  const token = useRef<string | null>(null);
  const request = useRef("");
  const corrections = useRef<string[]>([]);
  const lastBuilt = useRef<DaySlot | null>(null);
  const runPlan = useRef<{ weeks: number[]; daysPerWeek: number } | null>(null);
  const builtByRun = useRef<DaySlot[]>([]);
  const lastRequest = useRef<{ daysPerWeek: number | null }>({ daysPerWeek: null });
  const pauseRequested = useRef(false);
  const runPromise = useRef<Promise<void> | null>(null);
  const resuming = useRef(false);
  const referenceId = useRef<string | null>(null);
  const finishedWeeks = useRef<Set<number>>(new Set());
  const progressId = useRef<string | null>(null);
  const progressItems = useRef<ProgressItem[]>([]);
  const shownFlags = useRef<string[]>([]);
  const runFlags = useRef<string[]>([]);
  // The builder's own Spotter check (Nov 24): notes it kept on purpose this run, said once each (by the Spotter's key), at most 3 lines when the run stops.
  const keptKeys = useRef<string[]>([]);
  const keptLines = useRef<string[]>([]);
  const notesSent = useRef("");
  const whyThread = useRef<Exchange[]>([]);
  const pendingPlan = useRef<{ id: string; request: string } | null>(null);
  const edit = useRef<{ instruction: string; corrections: string[]; range: WeekRange | null } | null>(null);

  function rememberForClient() {
    if (!athleteId) return;
    const said = [request.current, ...corrections.current].join("|");
    if (!request.current.trim() || notesSent.current === said) return;
    notesSent.current = said;
    void fetch("/api/learning/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "learn", groupId, athleteId, text: request.current, corrections: corrections.current }) }).catch(() => {});
  }
  async function undoApplied(rule: AppliedRule) {
    const res = await fetch(`/api/learned-rules/${rule.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo" }) }).catch(() => null);
    if (res?.ok) setApplied((prev) => prev.filter((a) => a.id !== rule.id));
  }

  async function callDay(mode: "build" | "fix", slot: DaySlot): Promise<{ ok: true; workoutId: string; flags: string[]; applied: AppliedRule[] } | { ok: false; message: string }> {
    try {
      const res = await fetch("/api/ai/build-day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId, week: slot.week, day: slot.day, daysInWeek: runPlan.current?.daysPerWeek, mode, instruction: request.current, corrections: corrections.current, runToken: token.current ?? undefined, referenceClientId: referenceId.current, keptKeys: keptKeys.current }),
      });
      const data = await readAiJson(res);
      if (!res.ok || !data.workoutId) return { ok: false, message: (data.error as string | undefined) ?? COULDNT };
      if (typeof data.runToken === "string") token.current = data.runToken;
      for (const k of Array.isArray(data.kept) ? (data.kept as { key?: unknown; line?: unknown }[]) : []) {
        if (typeof k?.key !== "string" || typeof k.line !== "string" || keptKeys.current.includes(k.key)) continue;
        keptKeys.current = [...keptKeys.current, k.key];
        keptLines.current = [...keptLines.current, k.line];
      }
      return { ok: true, workoutId: data.workoutId as string, flags: Array.isArray(data.flags) ? (data.flags as string[]) : [], applied: Array.isArray(data.applied) ? (data.applied as AppliedRule[]) : [] };
    } catch {
      return { ok: false, message: COULDNT };
    }
  }

  // Draws the day in the builder; returns its title.
  async function show(workoutId: string): Promise<string | null> {
    const supabase = createBrowserClient();
    const [{ data }, headers] = await Promise.all([supabase.from("workouts").select(BUILDER_ONE_WORKOUT_SELECT).eq("id", workoutId).maybeSingle(), headersOfWorkouts(supabase, [workoutId])]);
    if (!data) return null;
    const day = mapWorkoutRowToBuilderDay(data, demoLibrary, new Map(Object.entries(exerciseTierByName)), new Set((headers.get(workoutId) ?? []).map((h) => h.id)));
    onDay(day);
    return day.title || null;
  }

  // What the builder kept on purpose after its own Spotter check: one message, at most 3 lines; then the Spotter's notes below the chat are read again for the new days.
  function sayKept() {
    const lines = keptLines.current.slice(0, MAX_KEPT_LINES);
    keptLines.current = [];
    if (lines.length > 0) say(lines.join("\n"));
    router.refresh();
  }
  function setProgress(items: ProgressItem[], ended: "done" | "paused" | null) {
    progressItems.current = items;
    const said = request.current;
    if (!progressId.current) progressId.current = push({ kind: "progress", items, ended, request: said });
    else patch(progressId.current, { items, ended, request: said } as Partial<ChatMsg>);
    if (ended) {
      const id = progressId.current;
      keep({ id, kind: "progress", items, ended, request: said });
      sayKept();
    }
  }

  function runQueue(): Promise<void> {
    const p = runQueueInner().finally(() => {
      if (runPromise.current === p) runPromise.current = null;
    });
    runPromise.current = p;
    return p;
  }

  async function runQueueInner() {
    setPhase("building");
    while (queue.current.length > 0) {
      if (pauseRequested.current) {
        setPhase("paused");
        setProgress(progressItems.current.filter((i) => i.state === "done"), "paused");
        return;
      }
      const slot = queue.current[0];
      setProgress([...progressItems.current.filter((i) => i.state === "done"), { week: slot.week, day: slot.day, title: null, state: "now" }], null);
      const result = await callDay("build", slot);
      if (!result.ok) {
        setPhase("paused");
        setProgress(progressItems.current.filter((i) => i.state === "done"), "paused");
        say(result.message.includes("already has exercises") ? `Week ${slot.week}, Day ${slot.day} already has exercises, so I left it. Say "redo day ${slot.day}" to replace it.` : result.message, "error");
        return;
      }
      const title = await show(result.workoutId);
      runFlags.current = mergeFlags(runFlags.current, result.flags, 20);
      if (result.applied.length > 0) setApplied((prev) => [...prev.filter((a) => !result.applied.some((n) => n.id === a.id)), ...result.applied]);
      lastBuilt.current = slot;
      builtByRun.current.push(slot);
      finishedWeeks.current.add(slot.week);
      queue.current.shift();
      setProgress([...progressItems.current.filter((i) => i.state === "done"), { week: slot.week, day: slot.day, title, state: "done" }], null);
    }
    setPhase("done");
    setProgress(progressItems.current, "done");
    rememberForClient();
    // a warning once, as a message (never the same line twice in this conversation)
    const fresh = runFlags.current.filter((f) => !shownFlags.current.includes(f));
    if (fresh.length > 0) {
      shownFlags.current = [...shownFlags.current, ...fresh];
      push({ kind: "warn", lines: fresh.slice(-3) });
    }
    const weeks = [...finishedWeeks.current].sort((a, b) => a - b);
    const top = weeks.length > 0 ? weeks[weeks.length - 1] : (lastBuilt.current?.week ?? 1);
    if (top < 24) push({ kind: "offer_week", week: top + 1 });
  }

  // A run from the coach's words: the days in order, the week's size sent with each day (where its mobility days go). `slots` for a rebuild (the days just cleared).
  // `keep`: changes that go along from the first day (a correction typed into a run whose days were deleted).
  function startRun(said: string, slots?: DaySlot[], keep: string[] = []) {
    request.current = said;
    keptKeys.current = [];
    keptLines.current = [];
    corrections.current = keep;
    token.current = null;
    pauseRequested.current = false;
    finishedWeeks.current = new Set();
    runFlags.current = [];
    progressId.current = null;
    progressItems.current = [];
    const existing = existingNow();
    const parsed = parseBuildRequest(said);
    lastRequest.current = { daysPerWeek: parsed.daysPerWeek };
    const planned = slots ?? planSlots(existing, parsed, trainingDaysCount);
    if (planned.length === 0) {
      say(`Every day in that range already has exercises. Say "rebuild week 1" to replace a week, or how many weeks to add, for example: make it 4 weeks.`);
      setPhase("idle");
      return;
    }
    runPlan.current = { weeks: [...new Set(planned.map((s) => s.week))], daysPerWeek: weekDaysFor(existing, parsed, trainingDaysCount) };
    builtByRun.current = [];
    queue.current = planned;
    lastBuilt.current = null;
    say(`Building week ${planned[0].week}. You can keep typing, or press Pause.`);
    void runQueue();
  }

  // The day being built finishes (and is drawn), then the run stops.
  function pause() {
    stopAllMics();
    if (pauseRequested.current) return;
    pauseRequested.current = true;
    say("Pausing after the day I'm on.");
  }

  // A change while building (after the day it is on) or while paused: applied to the day built last (or the day it names), then the run carries on.
  async function correct(said: string) {
    if (resuming.current) return;
    resuming.current = true;
    try {
      if (runPromise.current) {
        pauseRequested.current = true;
        if (said.trim()) say("Got it. I'll finish the day I'm on, then make that change.");
        await runPromise.current;
      }
      await resumeNow(said);
    } finally {
      resuming.current = false;
    }
  }

  async function resumeNow(saidIn: string) {
    let said = saidIn.trim();
    const existing = existingNow();
    // Nothing this run built is still there (the week was deleted): a request in its own right gets the plan turn; a change ("less volume") keeps the run's request and goes along.
    if (isFreshStart(existing, builtByRun.current)) {
      if (said && isNewRequest(said)) planTurn(said);
      else startRun(request.current, undefined, said ? [said] : []);
      return;
    }
    if (runPlan.current) queue.current = replanQueue(existing, runPlan.current);
    const scope = scopeLimitFrom(said);
    if (scope) {
      queue.current = queue.current.filter((s) => s.week <= scope.weeks);
      said = said.replace(new RegExp(scope.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "").trim();
    }
    pauseRequested.current = false;
    setPhase("building");
    if (said) {
      corrections.current = [...corrections.current, said];
      push({ kind: "learn", correction: said });
      const named = fixTargetFrom(said);
      const target: DaySlot | null = named ? { week: named.week ?? lastBuilt.current?.week ?? 1, day: named.day } : lastBuilt.current;
      const hasTarget = target && daysRef.current.some((d) => d.weekNumber === target.week && d.dayIndex === target.day && d.items.some((i) => i.kind === "exercise"));
      if (target && hasTarget) {
        const fixed = await callDay("fix", target);
        if (!fixed.ok) {
          setPhase("paused");
          say(fixed.message, "error");
          return;
        }
        await show(fixed.workoutId);
        runFlags.current = mergeFlags(runFlags.current, fixed.flags, 20);
        if (fixed.applied.length > 0) setApplied((prev) => [...prev.filter((a) => !fixed.applied.some((n) => n.id === a.id)), ...fixed.applied]);
        say(`Changed Week ${target.week}, Day ${target.day}.`);
      }
    }
    if (queue.current.length > 0) void runQueue();
    else setPhase("done");
  }

  async function resumeButton() {
    stopAllMics();
    await correct("");
  }

  function continueInto(week: number, msgId: string) {
    stopAllMics();
    if (phase === "building") return;
    patch(msgId, { done: true });
    token.current = null;
    pauseRequested.current = false;
    finishedWeeks.current = new Set();
    runFlags.current = [];
    progressId.current = null;
    progressItems.current = [];
    const existing = existingNow();
    const slots = planSlots(existing, { weeks: week, daysPerWeek: lastRequest.current.daysPerWeek, finishWeek: false }, trainingDaysCount).filter((s) => s.week === week);
    if (slots.length === 0) {
      say(`Week ${week} already has exercises.`);
      return;
    }
    runPlan.current = { weeks: [week], daysPerWeek: weekDaysFor(existing, { daysPerWeek: lastRequest.current.daysPerWeek }, trainingDaysCount) };
    builtByRun.current = [];
    queue.current = slots;
    void runQueue();
  }

  // ---- the plan-first turn ----
  // `keep`: a rebuild's own words, which go along as a change to the request (the plan line reads both, so it shows the same split before Do it).
  function planTurn(said: string, rebuild: RebuildTarget | null = null, keep: string | null = null) {
    const summary = planSummary(withKeep(said, keep), { existing: existingNow(), trainingDaysCount, trainingDays });
    const builtInWeek = rebuild ? daysRef.current.filter((d) => d.weekNumber === rebuild.week && d.items.some((i) => i.kind === "exercise")).length : 0;
    if (pendingPlan.current) patch(pendingPlan.current.id, { done: true });
    const id = push({
      kind: "plan",
      request: said,
      line: summary.line,
      sheetLine,
      questions: rebuild ? [] : missingQuestions(said),
      rebuild: rebuild ? { ...rebuild, replaces: replacesLine(rebuild, builtInWeek), said: keep } : null,
    });
    pendingPlan.current = { id, request: said };
  }

  // "rebuild week 1", "redo day 2": the program's own request is kept (this run's, or after a reload the newest one in the thread) and the words go along as a change.
  function rebuildTurn(said: string, target: RebuildTarget) {
    const r = rebuildRequest(request.current || lastRequestIn(msgsRef.current), said);
    planTurn(r.request, target, r.keep);
  }

  async function goFromPlan(msg: Extract<ChatMsg, { kind: "plan" }>, answers: string[]) {
    stopAllMics();
    if (inFlight.current || phase === "building") return;
    inFlight.current = true;
    try {
      patch(msg.id, { done: true });
      pendingPlan.current = null;
      const said = withAnswers(msg.request, answers);
      if (!msg.rebuild) {
        startRun(said);
        return;
      }
      // Rebuild: the days of that week (or the one day) are cleared, drawn again empty, and built again in the planned order.
      setBusy("rebuild");
      const target = { week: msg.rebuild.week, day: msg.rebuild.day };
      const ids = daysRef.current.filter((d) => d.weekNumber === target.week && (target.day == null || d.dayIndex === target.day) && d.items.some((i) => i.kind === "exercise")).map((d) => d.id);
      if (ids.length > 0) {
        // the same rule as the day builder: a program clients are already training on is never changed (checked before anything is cleared)
        if (await readProgramIsFollowed(createBrowserClient(), programId)) {
          say(FOLLOWED_PROGRAM_MESSAGE, "error");
          return;
        }
        // only after "Do it"; a refusal (no rows removed) counts as a failure, so nothing is built over days that are still there
        const cleared = await checked(createBrowserClient().from("group_workout_exercises").delete().in("workout_id", ids).select("id"), { expectRows: true });
        if (!cleared.ok) {
          say("Couldn't clear those days, so nothing was changed. Try again.", "error");
          return;
        }
        for (const id of ids) await show(id);
      }
      const kept = msg.rebuild.said ?? null;
      const d = planSummary(withKeep(said, kept), { existing: existingNow(), trainingDaysCount, trainingDays }).daysInWeek;
      startRun(said, rebuildSlots(target, d), kept ? [kept] : []);
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  // ---- answers ----
  async function explain(question: string) {
    setBusy("why");
    try {
      const res = await fetch("/api/ai/explain-program", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ programId, question, request: request.current || pendingPlan.current?.request || "", corrections: corrections.current, thread: whyThread.current }),
      });
      const data = await readAiJson(res);
      if (!res.ok || typeof data.answer !== "string") {
        say((data.error as string | undefined) ?? "Couldn't answer that. Try again.", "error");
        return;
      }
      whyThread.current = [...whyThread.current, { question, answer: data.answer as string }].slice(-EXPLAIN_MAX_EXCHANGES);
      push({ kind: "answer", question, text: data.answer as string, change: typeof data.change === "string" && data.change.trim() ? (data.change as string) : null });
    } catch {
      say("Couldn't answer that. Try again.", "error");
    } finally {
      setBusy(null);
    }
  }

  // ---- changes to built days: "Here's what I'll change", then Do it ----
  async function runPreview(next: { instruction: string; corrections: string[]; range: WeekRange }) {
    edit.current = next;
    setBusy("preview");
    try {
      const res = await fetch("/api/ai/edit-weeks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "preview", programId, instruction: next.instruction, corrections: next.corrections, range: next.range }) });
      const data = await readAiJson(res);
      if (!res.ok) {
        say((data.error as string | undefined) ?? "Couldn't work out those changes. Try saying it another way.", "error");
        return;
      }
      const lines = Array.isArray(data.lines) ? (data.lines as string[]) : [];
      const skipped = Array.isArray(data.skipped) ? (data.skipped as string[]) : [];
      if (lines.length === 0) {
        say([typeof data.question === "string" ? data.question : "Nothing to change.", ...skipped].join(" "));
        return;
      }
      push({ kind: "preview", lines, skipped, flags: Array.isArray(data.flags) ? mergeFlags([], data.flags as string[]) : [], plan: Array.isArray(data.plan) ? (data.plan as PlannedDay[]) : [] });
    } catch {
      say("Couldn't work out those changes. Try saying it another way.", "error");
    } finally {
      setBusy(null);
    }
  }

  function askEdit(said: string) {
    if (edit.current?.range) {
      void runPreview({ ...edit.current, range: edit.current.range, corrections: [...edit.current.corrections, said] });
      return;
    }
    if (edit.current && !edit.current.range) {
      const range = parseWeekRange(said) ?? (isYes(said) ? ({ kind: "weeks", from: 2, to: null } as const) : null);
      if (!range) {
        say(WHICH_WEEKS_QUESTION);
        return;
      }
      void runPreview({ instruction: edit.current.instruction, corrections: isYes(said) ? edit.current.corrections : [...edit.current.corrections, said], range });
      return;
    }
    const range = parseWeekRange(said);
    if (!range) {
      edit.current = { instruction: said, corrections: [], range: null };
      push({ kind: "say", text: WHICH_WEEKS_QUESTION });
      return;
    }
    void runPreview({ instruction: said, corrections: [], range });
  }

  function pickRange(range: WeekRange) {
    stopAllMics();
    if (!edit.current) return;
    void runPreview({ instruction: edit.current.instruction, corrections: edit.current.corrections, range });
  }

  async function applyPreview(msg: Extract<ChatMsg, { kind: "preview" }>) {
    stopAllMics();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("apply");
    try {
      const res = await fetch("/api/ai/edit-weeks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "apply", programId, plan: msg.plan }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        say((data.error as string | undefined) ?? "Couldn't save those changes, so nothing was changed. Try Do it again.", "error");
        return;
      }
      patch(msg.id, { done: true });
      const changed = Array.isArray(data.changedWorkoutIds) ? (data.changedWorkoutIds as string[]) : [];
      for (const id of changed) await show(id);
      const skipped = Array.isArray(data.skipped) ? (data.skipped as string[]) : [];
      const instruction = edit.current?.instruction ?? "";
      edit.current = null;
      say([`Done. ${changed.length} ${changed.length === 1 ? "day" : "days"} changed.`, ...skipped].join(" "));
      // the learning question, once, skippable
      if (instruction) push({ kind: "learn", correction: instruction });
    } finally {
      setBusy(null);
      inFlight.current = false;
    }
  }

  // A change offered with an answer ("CHANGE: ..."): straight to its preview (or the rebuild confirm), never "pass this along".
  function takeChange(msg: Extract<ChatMsg, { kind: "answer" }>) {
    stopAllMics();
    if (!msg.change) return;
    patch(msg.id, { done: true });
    const target = rebuildTargetFrom(msg.change);
    if (target && hasBuilt()) {
      rebuildTurn(msg.change, target);
      return;
    }
    edit.current = null;
    askEdit(msg.change);
  }

  // ---- one send ----
  async function send(textIn?: string) {
    stopAllMics();
    const said = (textIn ?? composer).trim();
    if (!said || inFlight.current || busy === "apply" || busy === "rebuild") return;
    inFlight.current = true;
    try {
      setComposer("");
      push({ kind: "coach", text: said });
      const intent = messageIntent(said, { phase, hasBuilt: hasBuilt(), editOpen: !!edit.current });
      if (intent === "pasted") {
        push({ kind: "import", text: said });
        return;
      }
      if (intent === "why") {
        await explain(said);
        return;
      }
      const target = intent === "rebuild" ? rebuildTargetFrom(said) : null;
      if (target) {
        rebuildTurn(said, target);
        return;
      }
      if (intent === "correction") {
        await correct(said);
        return;
      }
      if (intent === "edit") {
        askEdit(said);
        return;
      }
      // A reply to a plan still open ("60 minutes, 4 weeks, bands only") goes with it; a request in its own right ("actually make it a 4 day upper lower") replaces it.
      planTurn(pendingPlan.current && !isNewRequest(said) ? withAnswers(pendingPlan.current.request, [said]) : said);
    } finally {
      inFlight.current = false;
    }
  }

  const building = phase === "building";
  const lastId = msgs.length > 0 ? msgs[msgs.length - 1].id : null;
  const btn = "min-h-11 px-4 font-body text-sm border";
  const solid = `${btn} bg-rust text-graphite border-rust font-medium disabled:opacity-40`;
  const plain = `${btn} border-steel/40 text-chalk disabled:opacity-40`;

  return (
    <section aria-label="Build with AI" className="border border-steel/25 bg-surface/40 flex flex-col min-w-0" data-builder-chat>
      <div className="px-4 py-3 border-b border-steel/20 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display uppercase text-base tracking-wide text-chalk">Build with AI</h2>
        <span className="font-body text-xs text-steel">Nothing reaches the client until you assign it.</span>
        <div className="w-full flex flex-wrap items-center gap-x-4 gap-y-1">
          <ProgramImportLauncher groupId={groupId} athleteId={athleteId} orgProgram={orgProgram} programId={programId} />
          {/* "What I've learned" about this client (the old past-notes box), folded */}
          {athleteId && <PastAiNotes athleteId={athleteId} groupId={groupId} />}
        </div>
      </div>

      <div ref={threadEl} className="px-4 py-3 flex flex-col gap-3 @5xl:max-h-[70vh] @5xl:overflow-y-auto" data-builder-thread>
        {msgs.length === 0 && (
          <p className="font-body text-sm text-steel">
            Say what to build, for example: 5 day split, full body Monday, Wednesday and Friday, mobility Tuesday and Thursday. I&apos;ll show the plan first.
          </p>
        )}
        {msgs.map((m) => {
          const live = !m.historic && !m.done;
          if (m.kind === "coach")
            return (
              <div key={m.id} className="self-end max-w-[88%] bg-rust/10 border border-rust/30 px-3 py-2 font-body text-sm text-chalk whitespace-pre-wrap break-words" data-msg="coach">
                {m.text}
              </div>
            );
          return (
            <div key={m.id} className="self-start max-w-[94%] min-w-0" data-msg={m.kind}>
              <p className="font-body text-[11px] uppercase tracking-wide text-steel mb-0.5">Builder</p>
              {m.kind === "plan" && <PlanBubble msg={m} live={live} busy={busy !== null || building} onGo={(answers) => void goFromPlan(m, answers)} onNotNow={() => { stopAllMics(); patch(m.id, { done: true }); pendingPlan.current = null; say("Okay, nothing built or changed."); }} groupId={groupId} athleteId={athleteId} referenceId={referenceId} solid={solid} plain={plain} />}
              {m.kind === "progress" && (
                <div className="border-l-2 border-steel/30 pl-3 space-y-0.5">
                  {m.items.map((i) => (
                    <p key={`${i.week}-${i.day}`} className="font-body text-sm text-chalk">
                      <span aria-hidden="true" className={i.state === "done" ? "text-moss" : "text-rust-ink"}>{i.state === "done" ? "✓ " : "… "}</span>
                      Week {i.week}, Day {i.day}
                      {i.title ? ` · ${i.title}` : i.state === "now" ? " · building" : ""}
                    </p>
                  ))}
                  {m.ended === "paused" && <p className="font-body text-sm text-steel">Paused. Tell me what to change, or press Resume.</p>}
                  {m.ended === "done" && <p className="font-body text-sm text-steel">Done. It&apos;s in the builder.</p>}
                  {!m.historic && m.id === progressId.current && building && (
                    <button type="button" onClick={pause} className={`${plain} mt-1`}>
                      Pause
                    </button>
                  )}
                  {!m.historic && m.id === progressId.current && phase === "paused" && (
                    <button type="button" onClick={() => void resumeButton()} className={`${solid} mt-1`}>
                      Resume
                    </button>
                  )}
                  {!m.historic && m.id === progressId.current && applied.length > 0 && (
                    <ul className="mt-1 space-y-1" aria-label="Rules applied">
                      {applied.map((a) => (
                        <li key={a.id} className="flex items-start gap-2 font-body text-xs text-steel">
                          <span className="flex-1 min-w-0">{appliedLine(a)}</span>
                          <button type="button" onClick={() => void undoApplied(a)} className="min-h-11 px-2 underline shrink-0">
                            Undo
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {m.kind === "say" && (
                <p className={`font-body text-sm whitespace-pre-wrap break-words ${m.tone === "error" ? "text-rust-ink" : "text-chalk"}`} role={m.tone === "error" ? "alert" : undefined}>
                  {m.text}
                </p>
              )}
              {m.kind === "say" && live && m.text === WHICH_WEEKS_QUESTION && m.id === lastId && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {RANGE_CHIPS.map((c) => (
                    <button key={c.label} type="button" onClick={() => pickRange(c.range)} className={plain}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
              {m.kind === "warn" && (
                <p className="font-body text-sm border border-rust/40 bg-rust/5 px-3 py-2 text-chalk">
                  <span className="text-rust-ink font-medium">Worth a look: </span>
                  {m.lines.join(" · ")}
                </p>
              )}
              {m.kind === "offer_week" && (
                <div>
                  <p className="font-body text-sm text-chalk">Want me to carry on into Week {m.week} with the same days?</p>
                  {live && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button type="button" disabled={building} onClick={() => continueInto(m.week, m.id)} className={solid}>
                        Yes, build Week {m.week}
                      </button>
                      <button type="button" onClick={() => patch(m.id, { done: true })} className={plain}>
                        Not yet
                      </button>
                    </div>
                  )}
                </div>
              )}
              {m.kind === "answer" && (
                <div>
                  <p className="font-body text-sm text-chalk whitespace-pre-wrap break-words">{m.text}</p>
                  {live && m.change && (
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <button type="button" disabled={busy !== null || building} onClick={() => takeChange(m)} className={solid}>
                        Do it
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          stopAllMics();
                          patch(m.id, { done: true });
                        }}
                        className={plain}
                      >
                        No thanks
                      </button>
                      <span className="font-body text-xs text-steel">I&apos;ll show the change first.</span>
                    </div>
                  )}
                </div>
              )}
              {m.kind === "preview" && (
                <div className="border border-steel/25 bg-surface px-3 py-2" data-edit-preview>
                  <p className="font-body text-sm text-chalk font-medium">Here&apos;s what I&apos;ll change:</p>
                  <ul className="mt-1 space-y-1 list-disc pl-5">
                    {m.lines.map((l) => (
                      <li key={l} className="font-body text-sm text-chalk">
                        {l}
                      </li>
                    ))}
                  </ul>
                  {m.skipped.length > 0 && <p className="font-body text-xs text-steel mt-2">{m.skipped.join(". ")}.</p>}
                  {m.flags.length > 0 && <p className="font-body text-xs text-steel mt-1">Worth a look: {m.flags.join(" · ")}</p>}
                  {live && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button type="button" disabled={busy !== null} onClick={() => void applyPreview(m)} className={solid}>
                        {busy === "apply" ? "Doing it…" : "Do it"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          stopAllMics();
                          patch(m.id, { done: true });
                          say("Okay. Tell me what to change instead, or leave it as it is.");
                        }}
                        className={plain}
                      >
                        Not quite
                      </button>
                    </div>
                  )}
                </div>
              )}
              {m.kind === "learn" && !m.historic && <LearnLine correction={m.correction} programId={programId} groupId={groupId} athleteId={athleteId} />}
              {m.kind === "import" && (
                <div>
                  <p className="font-body text-sm text-chalk">This looks like a full program. Import it as it is, or build from it?</p>
                  {live && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          stopAllMics();
                          patch(m.id, { done: true });
                          setImportText(m.text);
                        }}
                        className={solid}
                      >
                        Import it
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          stopAllMics();
                          patch(m.id, { done: true });
                          planTurn(m.text);
                        }}
                        className={plain}
                      >
                        Build from it
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {spotterNotes && spotterNotes.length > 0 && !building && <ProgrammingSpotterPanel programId={programId} flags={spotterNotes} variant="chat" />}
        {busy === "why" && <p className="font-body text-sm text-steel">Thinking…</p>}
        {busy === "preview" && <p className="font-body text-sm text-steel">Working out the changes…</p>}
        {importText !== null && <ProgramImportPanel groupId={groupId} athleteId={athleteId} orgProgram={orgProgram} programId={programId} text={importText} onClose={() => setImportText(null)} />}
      </div>

      {/* The composer stays at the bottom of the screen on a phone (above the tab bar) while the thread is in view. */}
      <div className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] lg:bottom-0 z-10 bg-surface border-t border-steel/20 px-3 py-2 flex items-end gap-2" data-builder-composer>
        <textarea
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder={building ? "Change something, or ask why…" : "Ask, change something, or say what to build…"}
          aria-label="Message the builder"
          className="flex-1 min-w-0 bg-graphite border border-steel/30 text-chalk px-2 py-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
        <MicButton
          onText={(t) => setComposer((x) => (x.trim() ? `${x.trim()} ${t}` : t))}
          startLabel="Start voice typing"
          stopLabel="Stop voice typing"
          continuous
          unsupportedHint="Voice typing isn't available in this browser"
        />
        <button type="button" onClick={() => void send()} disabled={!composer.trim() || busy === "apply" || busy === "rebuild"} className="min-h-11 px-4 bg-rust text-graphite font-display font-bold uppercase tracking-wide disabled:opacity-40">
          Send
        </button>
      </div>
    </section>
  );
}

// The plan turn: the line from the parsers, the client's goal sheet, the questions with tap answers (one per question), and Build it / Not now (Do it / Not now for a rebuild).
// The template and "like another client" suggestions sit here too (they only show when the words match).
function PlanBubble({
  msg,
  live,
  busy,
  onGo,
  onNotNow,
  groupId,
  athleteId,
  referenceId,
  solid,
  plain,
}: {
  msg: Extract<ChatMsg, { kind: "plan" }>;
  live: boolean;
  busy: boolean;
  onGo: (answers: string[]) => void;
  onNotNow: () => void;
  groupId: string;
  athleteId: string | null;
  referenceId: { current: string | null };
  solid: string;
  plain: string;
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});
  const chip = (on: boolean) => `min-h-10 px-3 font-body text-sm border ${on ? "border-rust text-rust-ink" : "border-steel/40 text-chalk"}`;
  return (
    <div className="space-y-2" data-plan>
      <p className="font-body text-sm text-chalk">
        <span className="font-medium">Plan: </span>
        {msg.line}
      </p>
      {msg.sheetLine && <p className="font-body text-sm text-steel">{msg.sheetLine}</p>}
      {msg.rebuild && <p className="font-body text-sm text-chalk">{msg.rebuild.replaces} Rebuild?</p>}
      {msg.questions.map((q) => (
        <div key={q.key}>
          <p className="font-body text-sm text-chalk font-medium">{q.ask}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {q.options.map((o) => (
              <button
                key={o.label}
                type="button"
                disabled={!live}
                aria-pressed={picked[q.key] === o.adds}
                onClick={() => setPicked((p) => ({ ...p, [q.key]: p[q.key] === o.adds ? "" : o.adds }))}
                className={chip(picked[q.key] === o.adds)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {live && !msg.rebuild && (
        <>
          <TemplateSuggestion text={msg.request} />
          <LikeClientSuggestion text={msg.request} groupId={groupId} athleteId={athleteId} onUse={(id) => { referenceId.current = id; }} />
        </>
      )}
      {live && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={busy} onClick={() => onGo(Object.values(picked).filter(Boolean))} className={solid}>
            {msg.rebuild ? "Do it" : "Build it"}
          </button>
          <button type="button" onClick={onNotNow} className={plain}>
            Not now
          </button>
        </div>
      )}
      {live && msg.questions.length > 0 && <p className="font-body text-xs text-steel">Or just type your answers.</p>}
    </div>
  );
}
