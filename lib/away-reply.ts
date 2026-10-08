// The coach's "I'm away" preset reply (migration 0315): what the card shows. The database does the sending; this only decides what state to display.
export const MAX_AWAY_REPLY = 1000;
export const DEFAULT_AWAY_REPLY = "Hi, I'm away right now and will get back to you as soon as I can. If it's urgent, say so in your message.";

export type AwayReplyState = "off" | "on" | "ended";

// "on" while it is switched on and the last day (if any) has not passed; "ended" when it was on and the last day has passed (the database has stopped replying too); else "off".
// Days are YYYY-MM-DD in the coach's own time, today included in the away period.
export function awayReplyState(setting: { enabled: boolean; endsOn: string | null } | null, today: string): AwayReplyState {
  if (!setting || !setting.enabled) return "off";
  if (setting.endsOn && setting.endsOn < today) return "ended";
  return "on";
}
