import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const pushes: unknown[][] = [];
vi.mock("@/lib/push-notify", () => ({ notifyPush: (...args: unknown[]) => pushes.push(args) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));

import { coachThreadHref, sendDirectMessage } from "@/lib/direct-message-send";
import { QuietClientNudgeButton } from "@/components/coach/quiet-client-nudge-button";
import { DashboardHero } from "@/components/coach/desktop/dashboard-hero";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

// A stand-in for the browser's database client: records the insert and answers with the saved row (or an error).
function fakeDb(answer: { data: unknown; error: unknown }) {
  const seen: { table?: string; row?: unknown } = {};
  const chain = {
    insert(row: unknown) {
      seen.row = row;
      return chain;
    },
    select() {
      return chain;
    },
    single() {
      return Promise.resolve(answer);
    },
  };
  return { db: { from: (t: string) => ((seen.table = t), chain) } as never, seen };
}

describe("one way a direct message is sent (Ron, Nov 20: R1)", () => {
  it("writes the trimmed message as the sender, then pushes the client their conversation", async () => {
    pushes.length = 0;
    const { db, seen } = fakeDb({ data: { id: "m1", sender_id: "coach", body: "Hey Ann", created_at: "x" }, error: null });
    const sent = await sendDirectMessage(db, { groupId: "g1", senderId: "coach", senderName: "Ron Arnold", recipientId: "ann", body: "  Hey Ann  " });
    expect(sent?.id).toBe("m1");
    expect(seen).toEqual({ table: "direct_messages", row: { group_id: "g1", sender_id: "coach", recipient_id: "ann", body: "Hey Ann" } });
    expect(pushes).toEqual([["ann", "New message from Ron Arnold", "Hey Ann", "/groups/g1/messages/coach"]]);
  });
  it("a refused write sends no push and says it failed; a blank one is never sent", async () => {
    pushes.length = 0;
    const { db } = fakeDb({ data: null, error: { message: "denied" } });
    expect(await sendDirectMessage(db, { groupId: "g1", senderId: "c", senderName: "R", recipientId: "a", body: "Hi" })).toBeNull();
    expect(await sendDirectMessage(db, { groupId: "g1", senderId: "c", senderName: "R", recipientId: "a", body: "   " })).toBeNull();
    expect(pushes).toEqual([]);
  });
  it("the conversation composer uses the same send", () => {
    const thread = read("components/messages/direct-message-thread.tsx");
    expect(thread).toContain("sendDirectMessage(createBrowserClient(), { groupId, senderId: viewerId, senderName: viewerName, recipientId: otherId, body })");
    expect(thread).not.toContain('.from("direct_messages")\n      .insert(');
    expect(coachThreadHref("g1", "ann")).toBe("/groups/g1/messages/ann");
  });
});

describe("Message {name} on Home sends inside Spotlight", () => {
  it("keeps the three drafts and sends in the app, never through the share sheet; Copy text is only the fallback", () => {
    const src = read("components/coach/quiet-client-nudge-button.tsx");
    expect(src).toContain("getQuietClientNudgeTemplates(athleteFirstName)");
    expect(src).toContain("sendDirectMessage(createBrowserClient(), { groupId, senderId: coachId, senderName: coachName, recipientId: athleteId, body: draft })");
    expect(src).not.toContain("navigator.share");
    expect(src).toContain('{state === "failed" && (\n                  <button type="button" onClick={() => void handleCopy()}');
    expect(src).toContain("Sent to {athleteFirstName}");
    expect(src).toContain("Open the conversation");
  });
  it("renders the button for the client the box names, and the box gives it the client, the space and the coach", () => {
    const html = renderToStaticMarkup(createElement(QuietClientNudgeButton, { athleteId: "ann", athleteFirstName: "Ann", groupId: "g1", coachId: "coach", coachName: "Ron" }));
    expect(html).toContain("Message Ann →");
    const flag = { kind: "quiet_client" as const, athleteId: "ann", athleteName: "Ann Lee", groupId: "g1", groupName: "Ann", tier: "strong" as const, href: "/groups/g1/athletes/ann", orgName: null };
    expect(renderToStaticMarkup(createElement(DashboardHero, { flag, emptyState: null, viewer: { id: "coach", name: "Ron" } }))).toContain("Message Ann →");
    // without the signed-in coach there is nobody to send as, so it is not offered
    expect(renderToStaticMarkup(createElement(DashboardHero, { flag, emptyState: null }))).not.toContain("Message Ann");
    expect(read("app/(coach)/groups/[groupId]/team-performance/page.tsx")).toContain("viewer={{ id: user.id, name:");
  });
  it("the coach note's Message {name} already opens the conversation in the app", () => {
    expect(read("app/sessions/[sessionId]/coach-note/page.tsx")).toContain("href={`/groups/${session.group_id}/messages/${session.athlete_id}`}");
  });
});
