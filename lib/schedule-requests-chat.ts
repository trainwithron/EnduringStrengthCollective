import { dayLabel } from "@/lib/schedule-request-ui";

// Ask Spot can SHOW a coach their clients' schedule requests ("any schedule requests?", "who asked to pause?", "show Sam's pause requests"). Read-only: it never pauses,
// freezes or cancels anything (those happen from the card on the dashboard) and it never reads or repeats the client's private note.
export interface ScheduleRequestQuestion {
  text: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ").trim();

// Only a clear question about requests matches; a settings command or a how-to question is left to the rest of Ask Spot.
const COMMAND = /^(set|change|make|turn|let|allow|rename|call)\b/;
export function matchScheduleRequestQuestion(message: string): ScheduleRequestQuestion | null {
  const text = norm(message).replace(/[.!?]+$/, "");
  if (!text || text.length > 160 || COMMAND.test(text)) return null;
  if (/^how (do|can|to)\b/.test(text)) return null;
  const asks =
    /\bschedule (change )?requests?\b/.test(text) ||
    /\b(pause|freeze|cancel|cancellation)( or (pause|freeze|cancel))* requests?\b/.test(text) ||
    /\bwho (has |have )?(asked|requested|wants?) to (pause|freeze|cancel|stop|end)\b/.test(text);
  return asks ? { text } : null;
}

export interface ScheduleRequestLine {
  clientName: string;
  kind: "pause" | "freeze" | "cancel";
  effectiveOn: string;
  resumeOn: string | null;
}

const PHRASE = { pause: "pause", freeze: "freeze", cancel: "end" } as const;

// "2 schedule requests are waiting: Sam Lee asked to pause (sessions stay through Nov 3); Kim Wu asked to freeze until Dec 1 (sessions stay through Nov 10)."
export function describeScheduleRequests(items: ScheduleRequestLine[]): string {
  if (items.length === 0) return "No schedule requests are waiting.";
  const lines = items.slice(0, 8).map((r) => {
    const until = r.kind === "freeze" && r.resumeOn ? ` until ${dayLabel(r.resumeOn)}` : "";
    return `${r.clientName} asked to ${PHRASE[r.kind]}${until} (sessions stay through ${dayLabel(r.effectiveOn)})`;
  });
  const more = items.length > 8 ? `, and ${items.length - 8} more` : "";
  const head = items.length === 1 ? "1 schedule request is waiting: " : `${items.length} schedule requests are waiting: `;
  return `${head}${lines.join("; ")}${more}. Open them on your dashboard to message, apply or mark them handled.`;
}
