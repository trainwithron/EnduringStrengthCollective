// The coach's private calendar feed (Ron, Nov 20, wave 3 C8): an iCalendar file (RFC 5545) that Apple Calendar, Outlook, Google or any calendar app can subscribe to. Read only.
// Each event says only what it is and the person's FIRST name ("Session: Hewan", "Call: Jamie"): no last name, no notes, no email, no phone, no message. Times in UTC.
// Pure: the route reads the rows (app/api/calendar-feed/[token]/route.ts).

export const FEED_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
export const FEED_PAST_DAYS = 60;
export const FEED_FUTURE_DAYS = 365;

export interface FeedEvent {
  id: string;
  kind: "session" | "call";
  startAt: string;
  endAt: string;
  name: string | null;
}

/** "Hewan" from "Hewan Belete"; nothing at all when there is no name. */
export function firstNameOnly(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

/** Text as iCalendar wants it: backslash, semicolon and comma escaped, line breaks as \n. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded (a CRLF and a space), as the standard requires. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function eventSummary(e: FeedEvent): string {
  const who = firstNameOnly(e.name);
  const what = e.kind === "call" ? "Call" : "Session";
  return who ? `${what}: ${who}` : what;
}

export function buildIcs(events: FeedEvent[], calendarName: string, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Spotlight Coaching//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(calendarName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const dtstamp = stamp(now.toISOString());
  for (const e of events) {
    if (!Number.isFinite(Date.parse(e.startAt)) || !Number.isFinite(Date.parse(e.endAt))) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.kind}-${e.id}@spotlightcoaching.app`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(e.startAt)}`,
      `DTEND:${stamp(e.endAt)}`,
      `SUMMARY:${icsText(eventSummary(e))}`,
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
