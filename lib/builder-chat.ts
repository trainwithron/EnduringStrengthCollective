// The AI Program Builder as ONE conversation (Ron, Nov 24: "The program builder should really act as more like a chatbot instead of the what you ask for and ask why"; approved
// mockup reports/program-builder-chat-mockup.html). The pure parts: the messages, how they are saved with the program, the plan-first turn and its questions, and what a message
// from the coach is asking for. The conversation itself is components/coach/desktop/program-builder-chat.tsx; the building underneath is the same routes as before.
import { parseBuildRequest, weekDaysFor, type ExistingDay } from "@/lib/ai-day-request";
import { mobilityDayPlan, mobilityDaysWanted, namedMobilityDays } from "@/lib/ai-day-rules";
import { isEditRequest } from "@/lib/ai-week-edit";
import { detectImportKind } from "@/lib/import-input-kind";

// ---- the messages ----

export type QuestionKey = "weeks" | "session" | "equipment";
export interface PlanQuestion {
  key: QuestionKey;
  ask: string;
  options: { label: string; adds: string }[];
}
export interface RebuildTarget {
  week: number;
  day: number | null;
}
export interface ProgressItem {
  week: number;
  day: number;
  title: string | null;
  state: "done" | "now";
}

type Base = { id: string; historic?: boolean; done?: boolean };
export type ChatMsg = Base &
  (
    | { kind: "coach"; text: string }
    // the plan line from the deterministic parsers, the client's goal sheet line, the questions still missing, and (for "rebuild week 1") what it replaces
    | { kind: "plan"; request: string; line: string; sheetLine: string | null; questions: PlanQuestion[]; rebuild: (RebuildTarget & { replaces: string }) | null }
    | { kind: "progress"; items: ProgressItem[]; ended: "done" | "paused" | null }
    | { kind: "say"; text: string; tone?: "info" | "error" }
    | { kind: "warn"; lines: string[] }
    | { kind: "offer_week"; week: number }
    | { kind: "answer"; question: string; text: string; change: string | null }
    | { kind: "preview"; lines: string[]; skipped: string[]; flags: string[]; plan: unknown[] }
    | { kind: "learn"; correction: string }
    | { kind: "import"; text: string }
  );

// What is kept with the program (coach_chat_threads / coach_chat_messages with its program_id): the coach's words as they are, everything else as a small JSON object. A message
// read back is history: its buttons are not offered again (an old preview is never applied from an old screen). The interactive one-offs (the learning question, the import
// choice, the next-week offer) are not kept.
export const KEPT_KINDS: ReadonlySet<ChatMsg["kind"]> = new Set(["coach", "plan", "progress", "say", "warn", "answer", "preview"]);

export function encodeMsg(m: ChatMsg): { role: "coach" | "assistant"; body: string } | null {
  if (!KEPT_KINDS.has(m.kind)) return null;
  if (m.kind === "coach") return { role: "coach", body: m.text.slice(0, 4000) };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, historic, done, ...rest } = m;
  return { role: "assistant", body: JSON.stringify({ v: 1, ...rest }) };
}

export function decodeMsg(id: string, role: string, body: string): ChatMsg | null {
  if (role === "coach") return { id, kind: "coach", text: body, historic: true };
  try {
    const o = JSON.parse(body) as { v?: number; kind?: string };
    if (o && o.v === 1 && typeof o.kind === "string" && KEPT_KINDS.has(o.kind as ChatMsg["kind"])) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { v, ...rest } = o as Record<string, unknown>;
      return { ...(rest as object), id, historic: true, done: true } as ChatMsg;
    }
  } catch {
    // an older answer from the program chat: plain words
  }
  return { id, kind: "say", text: body, historic: true };
}

// ---- the plan-first turn ----

export const PLAN_QUESTIONS: Record<QuestionKey, PlanQuestion> = {
  weeks: { key: "weeks", ask: "How many weeks?", options: [{ label: "Just week 1", adds: "1 week" }, { label: "4 weeks", adds: "4 weeks" }, { label: "6 weeks", adds: "6 weeks" }] },
  session: { key: "session", ask: "How long can each session be?", options: [{ label: "45 min", adds: "45 minute sessions" }, { label: "60 min", adds: "60 minute sessions" }, { label: "75 min", adds: "75 minute sessions" }] },
  equipment: {
    key: "equipment",
    ask: "What equipment?",
    options: [{ label: "Full gym", adds: "full gym" }, { label: "Dumbbells only", adds: "dumbbells only" }, { label: "Home, bands only", adds: "at home with bands only" }],
  },
};

const SESSION_SAID = /\b\d{2,3}\s*-?\s*(?:min|mins|minutes?)\b|\b(?:an?|one|1|1\.5|half an?|two|2)\s*(?:hours?|hrs?)\b/i;
const EQUIPMENT_SAID = /\b(?:gym|dumbbells?|db|barbells?|bands?|kettlebells?|kb|machines?|cables?|bodyweight|body weight|equipment|at home|home gym|garage)\b/i;

// The questions still missing (at most 3), in a fixed order and with tap answers: the number of weeks, the session length and the equipment, each only when the words do not say it.
export function missingQuestions(text: string): PlanQuestion[] {
  const parsed = parseBuildRequest(text);
  const out: PlanQuestion[] = [];
  if (parsed.weeks == null && !parsed.finishWeek) out.push(PLAN_QUESTIONS.weeks);
  if (!SESSION_SAID.test(text)) out.push(PLAN_QUESTIONS.session);
  if (!EQUIPMENT_SAID.test(text)) out.push(PLAN_QUESTIONS.equipment);
  return out.slice(0, 3);
}

// The request with the tapped answers added, so the parsers and the builder read them like typed words.
export function withAnswers(request: string, answers: string[]): string {
  const extra = answers.map((a) => a.trim()).filter(Boolean);
  if (extra.length === 0) return request;
  return `${request.trim().replace(/[.\s]+$/, "")}. ${extra.join(". ")}.`;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function listWords(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export interface PlanSummary {
  daysInWeek: number;
  weeks: number | null;
  mobilityDays: number[] | null;
  line: string;
}

// The plan in one line, from the SAME parsers the builder uses (lib/ai-day-request.ts, lib/ai-day-rules.ts), so what it says and what gets built never disagree:
// "5 days a week: full body Mon, Wed and Fri, mobility Tue and Thu. 4 weeks." A weekday name is used when the program has exactly that many training days on its schedule,
// else day numbers. This is what catches a misheard number ("to mobility days") before anything is built.
export function planSummary(text: string, opts: { existing: ExistingDay[]; trainingDaysCount: number | null; trainingDays: number[] | null }): PlanSummary {
  const parsed = parseBuildRequest(text);
  const d = weekDaysFor(opts.existing, parsed, opts.trainingDaysCount);
  const named = namedMobilityDays(text, d, opts.trainingDays);
  const m = mobilityDaysWanted(text, d) ?? (named ? named.length : null);
  const mobility = m != null ? mobilityDayPlan(d, m, named) : null;
  const schedule = opts.trainingDays && opts.trainingDays.length === d ? [...new Set(opts.trainingDays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) : null;
  const dayNames = (days: number[]) => (schedule ? listWords(days.map((n) => WEEKDAY_SHORT[schedule[n - 1]])) : `day${days.length === 1 ? "" : "s"} ${listWords(days.map(String))}`);
  const mainWord = /\bfull[\s-]*body\b/i.test(text) ? "full body" : "training";
  let line = `${d} day${d === 1 ? "" : "s"} a week`;
  if (mobility && mobility.length > 0 && mobility.length < d) {
    const mains = Array.from({ length: d }, (_, i) => i + 1).filter((n) => !mobility.includes(n));
    line += `: ${mainWord} ${dayNames(mains)}, mobility ${dayNames(mobility)}`;
  } else if (mobility && mobility.length === d) {
    line += ": all mobility";
  }
  line += ".";
  if (parsed.weeks != null) line += ` ${parsed.weeks} week${parsed.weeks === 1 ? "" : "s"}.`;
  return { daysInWeek: d, weeks: parsed.weeks, mobilityDays: mobility, line };
}

// ---- what a message from the coach is asking for ----

export type Intent = "why" | "rebuild" | "edit" | "correction" | "request" | "pasted";

export function isWhyQuestion(text: string): boolean {
  const t = text.trim();
  return /^(why|how come|what'?s the (reason|point|idea)|what is the (reason|point)|explain)\b/i.test(t) || (/\bwhy\b/i.test(t) && /\?\s*$/.test(t));
}

// "rebuild week 1 ...", "redo week 2", "start over", "redo day 2": what to replace (the whole week, or one day). Null when the words do not ask for it.
export function rebuildTargetFrom(text: string): RebuildTarget | null {
  const t = text.toLowerCase();
  const oneDay = /\b(?:re-?do|re-?build|replace)\s+day\s*(\d)\b/.exec(t);
  if (oneDay) {
    const w = /\bweek\s*(\d{1,2})\b/.exec(t);
    return { week: w ? Number(w[1]) : 1, day: Number(oneDay[1]) };
  }
  // the whole week or program, never one exercise ("redo the squats lighter" is a change, not a rebuild)
  const whole =
    /\bstart(?:ing)? (?:it |this |that )?over\b|\bfrom scratch\b/.test(t) ||
    /\b(?:re-?build|re-?do|scrap)\s+(?:(?:the\s+)?week\s*\d{1,2}|the (?:whole )?(?:week|program|thing|plan)|(?:it|this|that)(?: all)?(?=\s*(?:$|[,.!?;:]))|everything)/.test(t);
  if (!whole) return null;
  const w = /\bweek\s*(\d{1,2})\b/.exec(t);
  return { week: w ? Number(w[1]) : 1, day: null };
}

export function messageIntent(text: string, ctx: { phase: "idle" | "building" | "paused" | "done"; hasBuilt: boolean; editOpen: boolean }): Intent {
  const busy = ctx.phase === "building" || ctx.phase === "paused";
  if (!busy && detectImportKind({ text }).kind === "pasted_program") return "pasted";
  if (isWhyQuestion(text)) return "why";
  if (ctx.hasBuilt && rebuildTargetFrom(text)) return "rebuild";
  if (busy) return "correction";
  if (ctx.editOpen) return "edit";
  if (isEditRequest(text, ctx.hasBuilt)) return "edit";
  return "request";
}

// The slots a rebuild replaces and builds again: the whole week (its planned days), or one day.
export function rebuildSlots(target: RebuildTarget, daysInWeek: number): { week: number; day: number }[] {
  if (target.day != null) return [{ week: target.week, day: target.day }];
  return Array.from({ length: Math.max(1, daysInWeek) }, (_, i) => ({ week: target.week, day: i + 1 }));
}

// "This replaces Week 1's 5 days." / "This replaces Week 1, Day 2."
export function replacesLine(target: RebuildTarget, builtDaysInWeek: number): string {
  if (target.day != null) return `This replaces Week ${target.week}, Day ${target.day}.`;
  return `This replaces Week ${target.week}'s ${builtDaysInWeek} ${builtDaysInWeek === 1 ? "day" : "days"}.`;
}
