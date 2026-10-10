import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("group events on the screens", () => {
  const body = read("components/coach/calendar-page-body.tsx");
  const answer = read("components/group/group-event-answer.tsx");
  const form = read("components/coach/group-event-form.tsx");
  const admin = read("components/coach/group-event-admin.tsx");
  const groupCal = read("app/(coach)/groups/[groupId]/group-calendar/page.tsx");
  const picker = read("app/(coach)/group-calendar/page.tsx");
  const shell = read("components/coach/coach-desktop-shell.tsx");

  it("the coach's Calendar shows group events labelled with the group's name, and each hidden holding booking only once", () => {
    expect(body).toContain('.from("group_sessions")');
    expect(body).toContain("`${itemGroupName.get(g.group_id ?? \"\") ?? \"Group\"}: ${g.title}`");
    expect(body).toContain("if (anchorIds.has(b.id)) continue;");
    expect(body).toContain("<AddGroupEvent groups={eventGroups}");
    // A one-on-one client's space is never offered as a group to add an event to.
    expect(body).toContain('filter((g) => g.kind !== "one_on_one")');
  });

  it("the Group calendar is one group only, with a fixed group in the form, and the picker never guesses a group", () => {
    expect(groupCal).toContain('.eq("kind", "event")');
    expect(groupCal).toContain('.eq("group_id", params.groupId)');
    expect(groupCal).toContain("fixedGroupId={params.groupId}");
    expect(picker).toContain("if (groups.length === 1) redirect(");
    expect(picker).toContain("Which one?");
    expect(shell).toContain('coachLevel ? "/group-calendar" : `/groups/${groupId}/group-calendar`');
  });

  it("the form says it costs no session and uses the coach's own word for group", () => {
    expect(form).toContain("Costs no session");
    expect(form).toContain('term("group")');
    expect(form).toContain('fetch("/api/group-events"');
    expect(read("components/coach/add-group-event.tsx")).toContain('term("group")');
  });

  it("members answer In or Out from the feed post and from their calendar, and a cancelled event hides the buttons", () => {
    expect(read("components/feed/user-post-card.tsx")).toContain("<EventAnswerButtons eventId={post.eventId}");
    expect(body).toContain("<UpcomingGroupEvents athleteId={athleteId}");
    expect(read("app/(coach)/groups/[groupId]/programs/[programId]/calendar/page.tsx")).toContain("<UpcomingGroupEvents athleteId={athleteId}");
    expect(answer).toContain("This event was cancelled.");
    expect(answer).toContain(">\n            In\n");
    expect(answer).toContain(">\n            Out\n");
    expect(answer).toContain("answerLabel(answer)");
  });

  it("the coach sees who is In and marks who was there; nothing on these screens touches a session", () => {
    expect(answer).toContain("inNames.join");
    expect(admin).toContain('action: "attended"');
    expect(admin).toContain("Nothing is charged or returned");
    for (const src of [answer, form, admin]) expect(src).not.toMatch(/adjust_session_credits|set_session_balance|assign_session_credits|session_credits/);
  });

  it("the feed post carries the event id both when the page loads and when a new post arrives live", () => {
    expect(read("app/(coach)/groups/[groupId]/feed/page.tsx")).toContain("eventId: p.group_session_id ?? null");
    expect(read("components/feed/feed-list.tsx")).toContain("eventId: (data as any).group_session_id ?? null");
  });
});
