import { describe, it, expect } from "vitest";
import { ANSWERED_QUIET_DAYS, ASK_HEADLINE, GAPS_CLIENTS_KEY, GAPS_KEY, HAPPY_QUIET_DAYS, scheduleGapsStage, wantedClientKind, type GapAnswerEvent } from "./schedule-gaps-question";

const now = new Date("2026-10-20T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
const ev = (key: string, detail: string | null, days: number): GapAnswerEvent => ({ key, detail, at: ago(days) });

describe("the gap question", () => {
  it("is a single friendly line with no weekday list in it", () => {
    expect(ASK_HEADLINE).toBe("You have gaps in your schedule. Are you looking to fill them, or happy where you are?");
    expect(ASK_HEADLINE).not.toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|straight weeks/);
  });
  it("asks when it has never been answered", () => {
    expect(scheduleGapsStage([], now)).toBe("ask");
  });
  it("'Happy where I am' keeps it quiet for 6 months, then it may ask again", () => {
    expect(scheduleGapsStage([ev(GAPS_KEY, "happy", 30)], now)).toBe("quiet");
    expect(scheduleGapsStage([ev(GAPS_KEY, "happy", HAPPY_QUIET_DAYS + 1)], now)).toBe("ask");
  });
  it("'Not now' keeps it quiet for 2 weeks", () => {
    expect(scheduleGapsStage([ev(GAPS_KEY, "later", 3)], now)).toBe("quiet");
    expect(scheduleGapsStage([ev(GAPS_KEY, "later", 15)], now)).toBe("ask");
  });
  it("'Looking to fill them' asks what kind of clients, until that is answered", () => {
    expect(scheduleGapsStage([ev(GAPS_KEY, "fill", 1)], now)).toBe("followup");
    expect(scheduleGapsStage([ev(GAPS_KEY, "fill", 40)], now)).toBe("followup");
  });
  it("an answered follow-up is remembered and the question stays quiet for 3 months", () => {
    const events = [ev(GAPS_KEY, "fill", 5), ev(GAPS_CLIENTS_KEY, "hybrid", 4)];
    expect(scheduleGapsStage(events, now)).toBe("quiet");
    expect(wantedClientKind(events)).toBe("hybrid");
    expect(scheduleGapsStage([ev(GAPS_KEY, "fill", ANSWERED_QUIET_DAYS + 5), ev(GAPS_CLIENTS_KEY, "online", ANSWERED_QUIET_DAYS + 4)], now)).toBe("ask");
  });
  it("'Not now' on the follow-up waits 2 weeks and then asks the follow-up again", () => {
    expect(scheduleGapsStage([ev(GAPS_KEY, "fill", 5), ev(GAPS_CLIENTS_KEY, "later", 2)], now)).toBe("quiet");
    expect(scheduleGapsStage([ev(GAPS_KEY, "fill", 30), ev(GAPS_CLIENTS_KEY, "later", 20)], now)).toBe("followup");
  });
  it("a newer main answer replaces an older follow-up", () => {
    expect(scheduleGapsStage([ev(GAPS_CLIENTS_KEY, "online", 50), ev(GAPS_KEY, "happy", 2)], now)).toBe("quiet");
    expect(scheduleGapsStage([ev(GAPS_CLIENTS_KEY, "online", 50), ev(GAPS_KEY, "fill", 2)], now)).toBe("followup");
  });
  it("only the three real kinds count as a wanted kind", () => {
    expect(wantedClientKind([ev(GAPS_CLIENTS_KEY, "later", 1)])).toBeNull();
    expect(wantedClientKind([])).toBeNull();
    expect(wantedClientKind([ev(GAPS_CLIENTS_KEY, "in_person", 1)])).toBe("in_person");
  });
});
