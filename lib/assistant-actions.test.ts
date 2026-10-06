import { describe, it, expect } from "vitest";
import { ACTION_LIMITS, bookingModeText, describeAction, matchAction, validateAction } from "./assistant-actions";

const id = (m: string) => matchAction(m)?.id ?? null;

describe("recognising a plain command", () => {
  it("changes the word for the people a coach coaches", () => {
    expect(matchAction("change clients to athletes")).toEqual({ id: "set_term", params: { term: { kind: "preset", value: "athlete" } } });
    expect(matchAction("Change 'clients' to 'players'")).toEqual({ id: "set_term", params: { term: { kind: "preset", value: "player" } } });
    expect(matchAction("call my clients members")).toEqual({ id: "set_term", params: { term: { kind: "preset", value: "member" } } });
    expect(matchAction("I want to call them athletes")).toEqual({ id: "set_term", params: { term: { kind: "preset", value: "athlete" } } });
    expect(matchAction("rename clients to swimmers")).toEqual({ id: "set_term", params: { term: { kind: "custom", value: "swimmers" } } });
    expect(matchAction("change athletes back to clients")).toEqual({ id: "set_term", params: { term: { kind: "default", value: "client" } } });
  });
  it("sets the gap between sessions", () => {
    expect(matchAction("set my buffer to 5 minutes")?.params.amount).toBe(5);
    expect(matchAction("make the gap between sessions 10")?.params.amount).toBe(10);
    expect(matchAction("change my gap to 15 min")).toEqual({ id: "set_buffer", params: { amount: 15 } });
    expect(matchAction("no buffer")).toEqual({ id: "set_buffer", params: { amount: 0 } });
    expect(matchAction("remove the gap between sessions")).toEqual({ id: "set_buffer", params: { amount: 0 } });
  });
  it("sets the cancellation window, notice, expiry and session length", () => {
    expect(matchAction("set the cancellation window to 12 hours")).toEqual({ id: "set_cancellation_hours", params: { amount: 12 } });
    expect(matchAction("make my cancellation policy 48 hours")).toEqual({ id: "set_cancellation_hours", params: { amount: 48 } });
    expect(matchAction("set minimum notice to 6 hours")).toEqual({ id: "set_notice_hours", params: { amount: 6 } });
    expect(matchAction("change the booking notice to 2 hours")).toEqual({ id: "set_notice_hours", params: { amount: 2 } });
    expect(matchAction("make unused sessions expire after 90 days")).toEqual({ id: "set_expiry_days", params: { amount: 90 } });
    expect(matchAction("sessions should never expire")).toEqual({ id: "set_expiry_days", params: { amount: 0 } });
    expect(matchAction("set my session length to 55 minutes")).toEqual({ id: "set_session_length", params: { amount: 55 } });
  });
  it("changes how clients book", () => {
    expect(matchAction("let clients book themselves")).toEqual({ id: "set_booking_mode", params: { mode: "free" } });
    expect(matchAction("have my clients request and I confirm")).toEqual({ id: "set_booking_mode", params: { mode: "request" } });
    expect(matchAction("make clients request sessions")).toEqual({ id: "set_booking_mode", params: { mode: "request" } });
    expect(matchAction("I schedule everyone")).toEqual({ id: "set_booking_mode", params: { mode: "coach_schedules" } });
  });

  it("a question or a request for steps is never a command", () => {
    for (const m of ["how do I change the buffer?", "what is my buffer", "where do I set the cancellation window", "how do I let clients book themselves", "what should my gap be"]) {
      expect(matchAction(m)).toBeNull();
    }
  });
  it("an unclear or unrelated message is not guessed at", () => {
    for (const m of ["", "show me my calendar", "open Johann's program", "buffer", "make it 5", "change it", "delete all my clients", "refund everyone", "send everyone a message", "change clients to the", "call clients please"]) {
      expect(id(m)).toBeNull();
    }
  });
  it("never treats money, deletes or messages to clients as something it can do", () => {
    for (const m of ["refund Johann", "charge Alice for the session", "delete the group", "cancel every session this week", "send a message to all clients", "set the price to 50 dollars", "give everyone 5 sessions"]) {
      expect(id(m)).toBeNull();
    }
  });
});

describe("the numbers follow the same limits as the settings screens", () => {
  it("accepts the edges and refuses outside them", () => {
    expect(validateAction({ id: "set_buffer", params: { amount: ACTION_LIMITS.buffer.max } })).toBeNull();
    expect(validateAction({ id: "set_buffer", params: { amount: 241 } })).toMatch(/0 to 240/);
    expect(validateAction({ id: "set_cancellation_hours", params: { amount: 721 } })).toMatch(/0 to 720/);
    expect(validateAction({ id: "set_expiry_days", params: { amount: 3651 } })).toMatch(/0 to 3650/);
    expect(validateAction({ id: "set_session_length", params: { amount: 4 } })).toMatch(/5 to 480/);
    expect(validateAction({ id: "set_session_length", params: { amount: 55 } })).toBeNull();
    expect(validateAction({ id: "set_buffer", params: { amount: 2.5 } })).toMatch(/whole number/);
    expect(validateAction({ id: "set_buffer", params: {} })).toMatch(/whole number/);
  });
  it("only the three booking modes, and a word that is a word", () => {
    expect(validateAction({ id: "set_booking_mode", params: { mode: "request" } })).toBeNull();
    expect(validateAction({ id: "set_booking_mode", params: { mode: "anything" as never } })).toMatch(/Choose how/);
    expect(validateAction({ id: "set_term", params: { term: { kind: "custom", value: "swimmers" } } })).toBeNull();
    expect(validateAction({ id: "set_term", params: { term: { kind: "custom", value: "x" } } })).toMatch(/3 to 30/);
    expect(validateAction({ id: "set_term", params: { term: { kind: "custom", value: "<script>" } } })).toMatch(/3 to 30/);
    expect(validateAction({ id: "set_term", params: { term: { kind: "preset", value: "robot" } } })).toMatch(/not one of the choices/);
  });
});

describe("the before/after card", () => {
  it("says what it is now and what it will be, in plain words", () => {
    const d = describeAction({ id: "set_buffer", params: { amount: 5 } }, { amount: 0 });
    expect(d).toEqual({ title: "Set the gap between sessions to 5 minutes?", beforeText: "0 minutes", afterText: "5 minutes" });
    expect(describeAction({ id: "set_term", params: { term: { kind: "preset", value: "athlete" } } }, { term: null }).title).toBe('Change the word "clients" to "athletes" everywhere?');
    expect(describeAction({ id: "set_expiry_days", params: { amount: 0 } }, { amount: 180 })).toMatchObject({ beforeText: "expire after 180 days", afterText: "never expire" });
    expect(describeAction({ id: "set_booking_mode", params: { mode: "free" } }, { mode: "coach_schedules" })).toMatchObject({ beforeText: "I schedule everyone", afterText: "Clients book themselves" });
    expect(bookingModeText(undefined)).toBe("I schedule everyone");
  });
});
