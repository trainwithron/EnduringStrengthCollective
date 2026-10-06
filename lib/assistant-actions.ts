// Ask Spot can DO a few settings, not only point to them (Ron, Oct 6). This file is the deterministic part: it recognises a plain request ("change clients to
// athletes", "set my gap to 5 minutes", "let clients book themselves"), checks the numbers against the same limits the settings screens use, and describes the
// change as a before/after card. It never touches the database and never calls an AI: nothing here can change anything. The server (lib/assistant-actions-server.ts)
// shows the card, and only a confirmed card, with a signed token, makes the same validated write the settings screen would.
//
// Only requests that are clearly commands match. A question ("how do I change the buffer?") is left to the how-to library, and an unclear request is never guessed:
// the answer is "I can't do that yet" with the places to do it by hand.

export type ActionId = "set_term" | "set_buffer" | "set_cancellation_hours" | "set_notice_hours" | "set_expiry_days" | "set_booking_mode" | "set_session_length";

export type BookingMode = "free" | "request" | "coach_schedules";

export interface TermParams {
  // Always the coach's word for the people they coach; the other word groups are changed in Settings.
  kind: "default" | "preset" | "custom";
  value: string;
}

export interface ActionRequest {
  id: ActionId;
  params: { amount?: number; mode?: BookingMode; term?: TermParams };
}

// The same limits as components/coach/desktop/booking-policy-control.tsx and lib/availability-edit.ts.
export const ACTION_LIMITS = {
  buffer: { min: 0, max: 240 },
  cancellationHours: { min: 0, max: 720 },
  noticeHours: { min: 0, max: 720 },
  expiryDays: { min: 0, max: 3650 },
  sessionMinutes: { min: 5, max: 480 },
} as const;

export const TERM_PRESET_WORDS: Record<string, string> = { athlete: "athlete", athletes: "athlete", player: "player", players: "player", member: "member", members: "member" };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// A question or a request for steps is never a command.
const QUESTION = /^(how|what|where|why|when|which|who|can you tell|is there|do i|does it|should i|could you explain)\b/;
const COMMAND_LEAD = /\b(set|change|make|put|update|switch|rename|call|use|turn|let|allow|stop|remove|get rid of|i want|i'd like|i would like|please|have|should|never|only i|i schedule|i book|clients can|athletes can)\b/;

function number(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : null;
}

// The word for the people the coach coaches, from "change clients to athletes", "call my clients players", "i want to call them members", "rename clients to swimmers".
function matchTerm(text: string): ActionRequest | null {
  const m =
    text.match(/\b(?:change|rename|switch|swap|call|use|refer to)\b\s+(?:my |the |all )?["']?(?:clients?|athletes?|players?|members?|customers?|people|them)["']?\s+(?:back |over )?(?:to|as|into|by)\s+["']?([a-z][a-z' -]{1,30})["']?\s*(?:instead|everywhere|throughout|from now on)?\s*$/) ??
    text.match(/\b(?:call|calling|refer to)\b\s+(?:my |the |all )?(?:clients?|athletes?|players?|members?|customers?|people|them)\s+["']?([a-z][a-z' -]{1,30})["']?\s*(?:instead|everywhere|throughout|from now on)?\s*$/) ??
    text.match(/\bi (?:want|would like|'d like) to call (?:them|my clients|my people|my athletes|my players) ["']?([a-z][a-z' -]{1,30})["']?\s*$/);
  if (!m) return null;
  const word = m[1].trim().replace(/\s+(instead|everywhere|throughout)$/, "").replace(/^['"]+|['"]+$/g, "").trim();
  if (!word || word.length < 3 || word.length > 30) return null;
  if (/\b(to|the|and|please|them|clients?)\b/.test(word) && !(word in TERM_PRESET_WORDS) && word !== "clients" && word !== "client") return null;
  if (word === "client" || word === "clients") return { id: "set_term", params: { term: { kind: "default", value: "client" } } };
  const preset = TERM_PRESET_WORDS[word];
  if (preset) return { id: "set_term", params: { term: { kind: "preset", value: preset } } };
  if (!/^[a-z][a-z' -]*[a-z]$/.test(word)) return null;
  return { id: "set_term", params: { term: { kind: "custom", value: word } } };
}

export function matchAction(message: string): ActionRequest | null {
  const text = norm(message).replace(/[.!?]+$/, "");
  if (!text || text.length > 200) return null;
  if (QUESTION.test(text)) return null;

  const term = matchTerm(text);
  if (term) return term;

  if (!COMMAND_LEAD.test(text) && !/^(no |zero )?(buffer|gap)\b/.test(text)) return null;

  // "no buffer", "remove the gap" -> 0
  if (/\b(no|zero|remove(?: the| my)?|get rid of(?: the| my)?|turn off(?: the| my)?|stop)\s+(?:session |booking )?(?:buffer|gap)\b/.test(text) || /\b(buffer|gap)\b.*\b(to )?(zero|none|off)\b/.test(text)) {
    return { id: "set_buffer", params: { amount: 0 } };
  }
  let m = text.match(/\b(?:buffer|gap)(?: between (?:my )?sessions)?\b.*?\b(\d{1,3})\s*(?:min|mins|minutes?)?\b/);
  if (m && number(m[1]) !== null) return { id: "set_buffer", params: { amount: number(m[1])! } };

  m = text.match(/\bcancell?ation (?:window|policy|period)\b.*?\b(\d{1,3})\s*(?:hours?|hrs?|h)\b/) ?? text.match(/\b(\d{1,3})\s*(?:hours?|hrs?|h)\b.*\bcancell?ation (?:window|policy|period)\b/);
  if (m && number(m[1]) !== null) return { id: "set_cancellation_hours", params: { amount: number(m[1])! } };

  m = text.match(/\b(?:minimum |min |booking )?(?:booking )?notice\b.*?\b(\d{1,3})\s*(?:hours?|hrs?|h)\b/) ?? text.match(/\b(\d{1,3})\s*(?:hours?|hrs?|h)\b.*\b(?:minimum |booking )?notice\b/);
  if (m && number(m[1]) !== null) return { id: "set_notice_hours", params: { amount: number(m[1])! } };

  if (/\b(?:sessions?|credits?|balances?)\b.*\b(?:never expire|not expire|don'?t expire|stop expiring)\b/.test(text) || /\b(?:turn off|remove|no)\b.*\b(?:expiry|expiration|expire)\b/.test(text)) {
    return { id: "set_expiry_days", params: { amount: 0 } };
  }
  m = text.match(/\b(?:expir\w*)\b.*?\b(\d{1,4})\s*days?\b/) ?? text.match(/\b(\d{1,4})\s*days?\b.*\b(?:expir\w*)\b/);
  if (m && number(m[1]) !== null) return { id: "set_expiry_days", params: { amount: number(m[1])! } };

  m = text.match(/\bsession (?:length|duration|time)\b.*?\b(\d{2,3})\s*(?:min|mins|minutes?)?\b/);
  if (m && number(m[1]) !== null) return { id: "set_session_length", params: { amount: number(m[1])! } };

  // Booking mode, only for plain statements of the three choices.
  if (/\b(?:let|allow)\s+(?:my |the )?(?:clients?|athletes?|players?|members?|people)\s+(?:book|schedule)\s+(?:sessions?\s+)?(?:themselves|on their own|directly)\b/.test(text) || /\b(?:clients?|athletes?|players?|members?)\s+can\s+book\s+(?:themselves|directly|on their own)\b/.test(text)) {
    return { id: "set_booking_mode", params: { mode: "free" } };
  }
  if (/\b(?:clients?|athletes?|players?|members?|people)\s+(?:should |must )?request\b.*\b(?:i|me)\b.*\bconfirm\b/.test(text) || /\b(?:make|have)\s+(?:my |the )?(?:clients?|athletes?|players?|members?|people)\s+request\b/.test(text) || /\brequest mode\b/.test(text)) {
    return { id: "set_booking_mode", params: { mode: "request" } };
  }
  if (/\bi (?:schedule|book) (?:everyone|everybody|all (?:the )?(?:sessions|clients))\b/.test(text) || /\b(?:only i|just i|i will|i'll) (?:schedule|book)\b/.test(text) || /\b(?:clients?|athletes?|players?|members?|people)\s+(?:can ?not|can't|cannot|shouldn't|should not)\s+book\b/.test(text)) {
    return { id: "set_booking_mode", params: { mode: "coach_schedules" } };
  }
  return null;
}

// null when the request is fine; otherwise one plain sentence.
export function validateAction(req: ActionRequest): string | null {
  const { id, params } = req;
  const range = (r: { min: number; max: number }, label: string) =>
    params.amount === undefined || !Number.isInteger(params.amount) || params.amount < r.min || params.amount > r.max ? `${label} must be a whole number from ${r.min} to ${r.max}.` : null;
  switch (id) {
    case "set_buffer":
      return range(ACTION_LIMITS.buffer, "The gap between sessions");
    case "set_cancellation_hours":
      return range(ACTION_LIMITS.cancellationHours, "The cancellation window");
    case "set_notice_hours":
      return range(ACTION_LIMITS.noticeHours, "The minimum notice");
    case "set_expiry_days":
      return range(ACTION_LIMITS.expiryDays, "The expiry");
    case "set_session_length":
      return range(ACTION_LIMITS.sessionMinutes, "The session length");
    case "set_booking_mode":
      return params.mode === "free" || params.mode === "request" || params.mode === "coach_schedules" ? null : "Choose how clients book.";
    case "set_term": {
      const t = params.term;
      if (!t) return "Say which word you want.";
      if (t.kind === "default") return null;
      if (t.kind === "preset") return Object.values(TERM_PRESET_WORDS).includes(t.value) ? null : "That word is not one of the choices.";
      if (t.kind === "custom") return t.value.length >= 3 && t.value.length <= 30 && /^[a-z][a-z' -]*[a-z]$/i.test(t.value) ? null : "Use a word of 3 to 30 letters.";
      return "Say which word you want.";
    }
  }
}

const MODE_TEXT: Record<BookingMode, string> = {
  free: "Clients book themselves",
  request: "Clients ask, I confirm",
  coach_schedules: "I schedule everyone",
};
export const bookingModeText = (m: string | null | undefined): string => MODE_TEXT[(m as BookingMode) ?? "coach_schedules"] ?? "I schedule everyone";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function termDisplay(t: TermParams | null | undefined): string {
  if (!t || t.kind === "default") return "clients";
  if (t.kind === "preset") return `${t.value}s`;
  return t.value;
}

// The words of the before/after card. `before` is whatever the server read from the database just now (a number, a mode, or a word).
export function describeAction(req: ActionRequest, before: { amount?: number | null; mode?: string | null; term?: TermParams | null }): { title: string; beforeText: string; afterText: string } {
  const a = req.params.amount ?? 0;
  switch (req.id) {
    case "set_term":
      return { title: `Change the word "${termDisplay(before.term ?? null)}" to "${termDisplay(req.params.term)}" everywhere?`, beforeText: termDisplay(before.term ?? null), afterText: termDisplay(req.params.term) };
    case "set_buffer":
      return { title: `Set the gap between sessions to ${plural(a, "minute", "minutes")}?`, beforeText: plural(before.amount ?? 0, "minute", "minutes"), afterText: plural(a, "minute", "minutes") };
    case "set_cancellation_hours":
      return { title: `Set the cancellation window to ${plural(a, "hour", "hours")}?`, beforeText: plural(before.amount ?? 24, "hour", "hours"), afterText: plural(a, "hour", "hours") };
    case "set_notice_hours":
      return { title: `Set the minimum booking notice to ${plural(a, "hour", "hours")}?`, beforeText: plural(before.amount ?? 0, "hour", "hours"), afterText: plural(a, "hour", "hours") };
    case "set_expiry_days":
      return {
        title: a === 0 ? "Stop unused sessions from expiring?" : `Let unused sessions expire ${plural(a, "day", "days")} after the last purchase?`,
        beforeText: (before.amount ?? 0) === 0 ? "never expire" : `expire after ${plural(before.amount ?? 0, "day", "days")}`,
        afterText: a === 0 ? "never expire" : `expire after ${plural(a, "day", "days")}`,
      };
    case "set_session_length":
      return { title: `Set the session length to ${plural(a, "minute", "minutes")} for all your hours?`, beforeText: before.amount ? plural(before.amount, "minute", "minutes") : "the same as the slot", afterText: plural(a, "minute", "minutes") };
    case "set_booking_mode":
      return { title: `Change how clients book to "${bookingModeText(req.params.mode)}"?`, beforeText: bookingModeText(before.mode), afterText: bookingModeText(req.params.mode) };
  }
}

// What the assistant says when it cannot do something yet: plainly, with where to do it by hand. Never a guess.
export const CANNOT_YET = "I can't do that one yet. I can change your word for your people, the gap between sessions, the cancellation window, minimum notice, how long sessions last before they expire, the session length, and how clients book.";
