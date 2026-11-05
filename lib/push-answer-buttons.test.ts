import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { answerableBody, requestAnswerLine, waitingRequestFor } from "@/lib/notification-push";

const read = (p: string) => readFileSync(p, "utf8");

function fakeDb(rows: unknown[] | null, error: unknown = null) {
  const calls: [string, unknown][] = [];
  const q: any = {
    select: () => q,
    eq: (k: string, v: unknown) => (calls.push([k, v]), q),
    limit: async () => ({ data: rows, error }),
  };
  return { db: { from: () => q }, calls };
}

describe("Confirm and Decline on a booking request's notification (Ron, Nov 5)", () => {
  it("finds the one waiting request written with the notice, and nothing when it is not exactly one", async () => {
    const one = fakeDb([{ id: "r1" }]);
    expect(await waitingRequestFor(one.db, { profile_id: "c", group_id: "g", created_at: "2026-11-05T10:00:00.123456+00:00" })).toBe("r1");
    expect(one.calls).toEqual([["coach_id", "c"], ["group_id", "g"], ["created_at", "2026-11-05T10:00:00.123456+00:00"], ["status", "pending"]]);
    expect(await waitingRequestFor(fakeDb([{ id: "a" }, { id: "b" }]).db, { profile_id: "c", group_id: "g", created_at: "x" })).toBeNull();
    expect(await waitingRequestFor(fakeDb([]).db, { profile_id: "c", group_id: "g", created_at: "x" })).toBeNull();
    expect(await waitingRequestFor(fakeDb(null, { message: "x" }).db, { profile_id: "c", group_id: "g", created_at: "x" })).toBeNull();
    expect(await waitingRequestFor(fakeDb([{ id: "r1" }]).db, { profile_id: "c", group_id: null, created_at: "x" })).toBeNull();
  });
  it("the phone says who and when, without the closing instruction", () => {
    expect(answerableBody("Oliver B. asked for a session on Thu Nov 5, 9:00 AM. Confirm or decline.")).toBe("Oliver B. asked for a session on Thu Nov 5, 9:00 AM.");
    expect(answerableBody("")).toBe("A client asked for a session.");
  });
  it("says what happened after a button", () => {
    expect(requestAnswerLine("confirmed")).toContain("Confirmed");
    expect(requestAnswerLine("declined")).toContain("Declined");
    expect(requestAnswerLine("slot_taken")).toContain("taken first");
    expect(requestAnswerLine("already")).toContain("already answered");
    expect(requestAnswerLine("closed")).toContain("closed");
  });
  it("private lock screens get no buttons, and the worker opens the requests when a button cannot save", () => {
    expect(read("lib/send-push.ts")).toContain("...(opts.answer && !prefs.generic ? { requestId: opts.answer.requestId } : {})");
    const sw = read("public/sw.js");
    expect(sw).toContain('actions: [{ action: "confirm", title: "Confirm" }, { action: "decline", title: "Decline" }]');
    expect(sw).toContain('fetch("/api/bookings/request-answer"');
    expect(sw).toContain("return openApp(url);");
    expect(sw).toContain("return parsed.pathname + parsed.search + parsed.hash;");
  });
  it("the answer is decided by the database as the signed-in coach", () => {
    const route = read("app/api/bookings/request-answer/route.ts");
    expect(route).toContain('supabase.rpc("resolve_booking_request", { p_request_id: requestId, p_confirm: body.confirm })');
    expect(route).toContain('if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });');
    expect(route).not.toContain("service-role");
  });
});
