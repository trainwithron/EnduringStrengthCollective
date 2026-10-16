import { describe, it, expect } from "vitest";
import { MAX_QUICK_ENDS, QUICK_END_MS, createMicSession, type RecognitionLike } from "@/lib/mic-session";

class FakeRec implements RecognitionLike {
  lang = ""; interimResults = false; continuous = false;
  onresult: ((e: any) => void) | null = null; onend: (() => void) | null = null; onerror: ((e: any) => void) | null = null;
  started = false; stopped = false;
  start() { this.started = true; }
  stop() { this.stopped = true; this.onend?.(); }
  say(parts: { t: string; final: boolean }[], resultIndex = 0) {
    this.onresult?.({ resultIndex, results: parts.map((p) => Object.assign([{ transcript: p.t }], { isFinal: p.final })) });
  }
  endByItself() { this.onend?.(); }
}

function setup(continuous = true) {
  const recs: FakeRec[] = [];
  const texts: string[] = [];
  const states: boolean[] = [];
  let t = 0;
  const session = createMicSession({ make: () => { const r = new FakeRec(); recs.push(r); return r; }, continuous, onText: (x) => texts.push(x), onListening: (v) => states.push(v), now: () => t });
  return { session, recs, texts, states, advance: (ms: number) => { t += ms; } };
}

describe("microphone sessions", () => {
  it("asks for words as they are heard (interim on) and keeps listening through pauses", () => {
    const { session, recs } = setup();
    session.start();
    expect(recs[0].started && recs[0].interimResults && recs[0].continuous).toBe(true);
  });
  it("when the browser ends a session on a silence, listening starts again by itself until the coach taps stop", () => {
    const { session, recs, states, advance } = setup();
    session.start();
    advance(8000); recs[0].endByItself();
    expect(recs).toHaveLength(2);
    expect(recs[1].started).toBe(true);
    expect(states).toEqual([true]); // never shown as stopped
    advance(8000); recs[1].endByItself();
    expect(recs).toHaveLength(3);
    session.stop();
    expect(recs[2].stopped).toBe(true);
    expect(states).toEqual([true, false]);
    expect(recs).toHaveLength(3); // tapping stop does not start again
  });
  it("a phrase still unfinished when listening ends is kept, not lost", () => {
    const { session, recs, texts, advance } = setup();
    session.start();
    recs[0].say([{ t: "swap the squats for", final: false }]);
    expect(texts).toEqual([]);
    advance(8000); recs[0].endByItself();
    expect(texts).toEqual(["swap the squats for"]);
  });
  it("finished phrases come once, in order, and an interim phrase that later finishes is not added twice", () => {
    const { session, recs, texts, advance } = setup();
    session.start();
    recs[0].say([{ t: "make day two", final: false }]);
    recs[0].say([{ t: "make day two shorter", final: true }]);
    recs[0].say([{ t: "make day two shorter", final: true }, { t: "and lighter", final: false }], 1);
    advance(8000); recs[0].endByItself();
    expect(texts).toEqual(["make day two shorter", "and lighter"]);
  });
  it("tapping stop keeps the unfinished words too", () => {
    const { session, recs, texts } = setup();
    session.start();
    recs[0].say([{ t: "almost done", final: false }]);
    session.stop();
    expect(texts).toEqual(["almost done"]);
  });
  it("stops retrying after a few quick ends in a row (no restart loop)", () => {
    const { session, recs, states, advance } = setup();
    session.start();
    for (let i = 0; i < 10 && session.isListening(); i++) { advance(QUICK_END_MS - 100); recs[recs.length - 1].endByItself(); }
    expect(recs.length).toBe(MAX_QUICK_ENDS);
    expect(session.isListening()).toBe(false);
    expect(states).toEqual([true, false]);
  });
  it("a denied microphone stops at once, with no retry", () => {
    const { session, recs, states, advance } = setup();
    session.start();
    recs[0].onerror?.({ error: "not-allowed" });
    advance(100); recs[0].endByItself();
    expect(recs).toHaveLength(1);
    expect(states).toEqual([true, false]);
  });
  it("no-speech and aborted do not stop a long session that has been listening", () => {
    const { session, recs, advance } = setup();
    session.start();
    recs[0].onerror?.({ error: "no-speech" });
    advance(10_000); recs[0].endByItself();
    expect(recs).toHaveLength(2);
    expect(session.isListening()).toBe(true);
  });
  it("without continuous mode one session ends when the browser ends it", () => {
    const { session, recs, states, advance } = setup(false);
    session.start();
    advance(5000); recs[0].endByItself();
    expect(recs).toHaveLength(1);
    expect(states).toEqual([true, false]);
  });
});
