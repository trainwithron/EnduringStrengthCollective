// The coach conversation, in chapters. Only the programming chapter exists now; a new chapter is one more entry here (its key must also be allowed by the database's chapter check).
// Pure; no database.

export interface Chapter {
  key: "programming";
  title: string;
  minutes: string;
  // What this chapter is for, handed to the AI as its goal.
  goal: string;
  // How many answers from the coach before the app wraps up with a read-back.
  maxCoachTurns: number;
}

export const CHAPTERS: Chapter[] = [
  {
    key: "programming",
    title: "How you program",
    minutes: "2 to 3 minutes",
    goal: "how this coach builds training programs: why they order a session the way they do, what they always include, what they never program, how they progress week to week, and how they pick between similar exercises",
    maxCoachTurns: 8,
  },
];

export function getChapter(key: string): Chapter | null {
  return CHAPTERS.find((c) => c.key === key) ?? null;
}

// The invitation. Draft wording: Ron has not approved the final text, so it lives here as one editable string. It must not promise a time line in months.
export const INTRO_TEXT =
  "Hi, I'm your Programming Spotter. My one job is to make your job easier, so you can spend your energy on your clients. To do that well, I need to learn how you coach. All I need is five to ten minutes. I'd encourage you to turn your mic on and just talk with me. I'll ask you questions I need the answers to, like why you build your weeks the way you do, and what you'd never program. At first I'll ask questions as I go. The more I learn, the fewer I'll need. If you'd rather I didn't ask, you can turn the questions off any time, in 'What I've learned about how you coach.' Just know the AI builder will give you less tailored results if I don't learn from you. That's your call, and it's fine either way. I'll also question you, the way you'd question a client you want to see improve. If something doesn't add up to me, I'll say so, kindly and briefly, and you decide. If I get something wrong, tell me. You stay in charge. Nothing reaches a client until you sign off. Tap the chat button any time to change what I've learned. Ready? Help me help you.";

export type InviteState = "new" | "shown" | "later" | "declined" | "started" | "done";
export type InviteKind = "invite" | "reminder" | "none";

const DAY = 86400000;
export const INVITE_VISIBLE_DAYS = 7;
export const INVITE_WINDOW_DAYS = 30;
export const MIN_PROGRAMS_FOR_INVITE = 3;

// Whether to show the one invitation. It only appears once the coach has a few programs, only in the 30 days after their third one, only while they have not turned questions off,
// and it never nags: shown for a week at most, then gone; "Not now" brings back ONE gentle reminder a week later and nothing after that. The conversation itself is always reachable
// from "What I've learned about how you coach", whatever this says.
export function inviteDue(opts: {
  state: InviteState;
  reminders: number;
  shownAt: Date | null;
  questionsEnabled: boolean;
  programCount: number;
  thirdProgramAt: Date | null;
  now: Date;
}): InviteKind {
  if (!opts.questionsEnabled || opts.programCount < MIN_PROGRAMS_FOR_INVITE || !opts.thirdProgramAt) return "none";
  if (opts.now.getTime() > opts.thirdProgramAt.getTime() + INVITE_WINDOW_DAYS * DAY) return "none";
  const sinceShown = opts.shownAt ? opts.now.getTime() - opts.shownAt.getTime() : 0;
  switch (opts.state) {
    case "new":
      return "invite";
    case "shown":
      return opts.shownAt && sinceShown >= INVITE_VISIBLE_DAYS * DAY ? "none" : "invite";
    case "later":
      return opts.reminders === 0 && opts.shownAt && sinceShown >= INVITE_VISIBLE_DAYS * DAY ? "reminder" : "none";
    default:
      return "none";
  }
}

export interface ProposedRule {
  condition: string;
  preference: string;
}

export type TurnResult = { done: false; question: string } | { done: true; readback: string; rules: ProposedRule[] };

// The AI's answer for one turn, checked. Anything that is not the expected shape is refused rather than guessed at.
export function parseTurn(raw: unknown): TurnResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.done === true) {
    const readback = typeof r.readback === "string" ? r.readback.trim().slice(0, 1500) : "";
    if (!readback) return null;
    const rules: ProposedRule[] = Array.isArray(r.rules)
      ? (r.rules as unknown[])
          .map((x) => {
            const o = x as Record<string, unknown>;
            return { condition: typeof o?.condition === "string" ? o.condition.trim().slice(0, 200) : "", preference: typeof o?.preference === "string" ? o.preference.trim().slice(0, 300) : "" };
          })
          .filter((x) => x.condition && x.preference)
          .slice(0, 6)
      : [];
    return { done: true, readback, rules };
  }
  const question = typeof r.question === "string" ? r.question.trim().slice(0, 600) : "";
  return question ? { done: false, question } : null;
}
