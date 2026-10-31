"use client";

import { useState } from "react";
import Link from "next/link";
import { GroupEventForm } from "@/components/coach/group-event-form";
import { GroupEventAdmin, type EventPerson } from "@/components/coach/group-event-admin";
import { GroupSessionDetail, GroupSessionForm, type ClassRow, type ClientOption } from "./group-sessions-manager";
import { classSummaryLine } from "@/lib/group-sessions";
import { dateKeyInZone } from "@/lib/timezone";
import { addDaysToDateKey } from "@/lib/series-schedule";
import { formatInTimezone } from "@/lib/format-in-timezone";

export type BoardItem =
  | {
      kind: "event";
      id: string;
      groupName: string;
      event: { id: string; title: string; startAt: string; status: string; place: string | null; note: string | null; capacity: number | null };
      people: EventPerson[];
    }
  | { kind: "session"; id: string; groupName: string; cls: ClassRow };

export type BoardShow = "all" | "events" | "sessions";

const startOf = (i: BoardItem) => (i.kind === "event" ? i.event.startAt : i.cls.startIso);
const titleOf = (i: BoardItem) => (i.kind === "event" ? i.event.title : i.cls.title);
const cancelledOf = (i: BoardItem) => (i.kind === "event" ? i.event.status === "cancelled" : i.cls.status === "cancelled");

// The counts line on a card: who answered an event, how full a group session is.
function countsLine(i: BoardItem): string {
  if (cancelledOf(i)) return "Cancelled";
  if (i.kind === "event") {
    const inCount = i.people.filter((p) => p.status === "joined" || p.status === "attended").length;
    const out = i.people.filter((p) => p.status === "cancelled").length;
    return `${inCount} in, ${out} out${i.event.capacity ? ` · ${i.event.capacity} spots` : ""}`;
  }
  const joined = i.cls.attendees.filter((a) => a.status === "joined" || a.status === "attended").length;
  const waiting = i.cls.attendees.filter((a) => a.status === "waitlisted").length;
  return classSummaryLine({ capacity: i.cls.capacity, joined, waitlisted: waiting });
}

// Group calendar (layout audit, Oct 31: Group calendar and Group sessions are one page). Events (free, members answer In or Out) and group sessions (one
// session each, spots and a waiting list) in one list by day, with a two-week strip on top. Opening a card shows its roster on the right; with nothing open
// the right side is the New form, with an Event / Group session switch.
export function GroupCalendarBoard({
  items,
  clients,
  groupId,
  groupName,
  timezone,
  nowIso,
  initialShow,
  initialId,
  allGroups,
  scopeHref,
}: {
  items: BoardItem[];
  clients: ClientOption[];
  groupId: string;
  groupName: string;
  timezone: string;
  nowIso: string;
  initialShow: BoardShow;
  initialId: string | null;
  // Showing every group the coach coaches in this organization (each card then names its group).
  allGroups: boolean;
  scopeHref: { group: string; all: string };
}) {
  const [show, setShow] = useState<BoardShow>(initialShow);
  const [openId, setOpenId] = useState<string | null>(initialId && items.some((i) => i.id === initialId) ? initialId : null);
  const [newKind, setNewKind] = useState<"event" | "session">(initialShow === "sessions" ? "session" : "event");
  const [day, setDay] = useState<string | null>(null);

  const now = new Date(nowIso).getTime();
  const dayOf = (i: BoardItem) => dateKeyInZone(timezone, new Date(startOf(i)));
  const shown = items.filter((i) => show === "all" || (show === "events" ? i.kind === "event" : i.kind === "session"));
  const listed = day ? shown.filter((i) => dayOf(i) === day) : shown;
  const upcoming = listed.filter((i) => new Date(startOf(i)).getTime() >= now).sort((a, b) => startOf(a).localeCompare(startOf(b)));
  const recent = listed.filter((i) => new Date(startOf(i)).getTime() < now).sort((a, b) => startOf(b).localeCompare(startOf(a)));
  const open = items.find((i) => i.id === openId) ?? null;

  const today = dateKeyInZone(timezone, new Date(nowIso));
  const strip = Array.from({ length: 14 }, (_, n) => addDaysToDateKey(today, n));
  const countByDay = new Map<string, number>();
  for (const i of shown) if (!cancelledOf(i)) countByDay.set(dayOf(i), (countByDay.get(dayOf(i)) ?? 0) + 1);

  const detail = (i: BoardItem) =>
    i.kind === "event" ? (
      <ul>
        <GroupEventAdmin event={i.event} people={i.people} timezone={timezone} />
      </ul>
    ) : (
      <GroupSessionDetail key={i.id} cls={i.cls} clients={clients} timezone={timezone} nowIso={nowIso} />
    );

  const chip = (on: boolean) => `h-8 px-3 inline-flex items-center font-body text-xs border ${on ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel hover:text-chalk"}`;

  function card(i: BoardItem) {
    const isOpen = openId === i.id;
    return (
      <li key={i.id}>
        <button
          type="button"
          onClick={() => setOpenId(isOpen ? null : i.id)}
          aria-expanded={isOpen}
          className={`w-full text-left border p-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 ${isOpen ? "border-rust bg-rust/5" : "border-steel/25 bg-surface hover:border-steel/50"}`}
        >
          <span className="font-body text-sm text-steel tabular-nums w-16 shrink-0">{formatInTimezone(new Date(startOf(i)), timezone, "time")}</span>
          <span className={`font-body text-sm flex-1 min-w-[8rem] ${cancelledOf(i) ? "text-steel line-through" : "text-chalk"}`}>{titleOf(i)}</span>
          <span className={`font-body text-[11px] uppercase tracking-wide px-1.5 py-0.5 border ${i.kind === "event" ? "border-moss/60 text-moss" : "border-blue/60 text-blue-400"}`}>
            {i.kind === "event" ? "Event · free" : "Group session · 1 session"}
          </span>
          <span className="basis-full font-body text-xs text-steel pl-[4.75rem]">
            {countsLine(i)}
            {allGroups ? ` · ${i.groupName}` : ""}
          </span>
        </button>
        {/* On a narrow page the roster opens under its card; on a wide one it sits on the right. */}
        {isOpen && <div className="mt-2 @4xl:hidden">{detail(i)}</div>}
      </li>
    );
  }

  function byDay(list: BoardItem[]) {
    const groups: { key: string; items: BoardItem[] }[] = [];
    for (const i of list) {
      const k = dayOf(i);
      const last = groups[groups.length - 1];
      if (last && last.key === k) last.items.push(i);
      else groups.push({ key: k, items: [i] });
    }
    return groups.map((g) => (
      <div key={g.key}>
        <p className="font-display uppercase text-xs tracking-wide text-steel mb-1.5">{formatInTimezone(new Date(startOf(g.items[0])), timezone, "date")}</p>
        <ul className="space-y-2">{g.items.map(card)}</ul>
      </div>
    ));
  }

  return (
    <div className="grid grid-cols-1 gap-8 items-start @4xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "events", "sessions"] as BoardShow[]).map((s) => (
            <button key={s} type="button" onClick={() => setShow(s)} aria-pressed={show === s} className={chip(show === s)}>
              {s === "all" ? "Both" : s === "events" ? "Events" : "Group sessions"}
            </button>
          ))}
          <span className="w-px h-5 bg-steel/30 mx-1" aria-hidden />
          <Link href={scopeHref.group} aria-current={!allGroups ? "page" : undefined} className={chip(!allGroups)}>
            {groupName}
          </Link>
          <Link href={scopeHref.all} aria-current={allGroups ? "page" : undefined} className={chip(allGroups)}>
            All my groups
          </Link>
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="ml-auto h-8 px-3 inline-flex items-center font-body text-xs border border-rust text-rust hover:bg-rust/10"
          >
            + New
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1" aria-label="The next two weeks">
          {strip.map((k) => {
            const n = countByDay.get(k) ?? 0;
            const on = day === k;
            const d = new Date(`${k}T12:00:00Z`);
            return (
              <button
                key={k}
                type="button"
                onClick={() => setDay(on ? null : k)}
                aria-pressed={on}
                aria-label={`${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}: ${n} scheduled`}
                className={`h-14 border flex flex-col items-center justify-center gap-0.5 ${on ? "border-rust bg-rust/10" : k === today ? "border-steel/50" : "border-steel/20"}`}
              >
                <span className="font-body text-[10px] uppercase text-steel">{d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</span>
                <span className="font-body text-sm text-chalk tabular-nums">{d.getUTCDate()}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${n > 0 ? "bg-rust" : "bg-transparent"}`} aria-hidden />
              </button>
            );
          })}
        </div>
        {day && (
          <p className="font-body text-xs text-steel">
            Showing {formatInTimezone(new Date(`${day}T12:00:00Z`), "UTC", "date")} only.{" "}
            <button type="button" onClick={() => setDay(null)} className="text-rust underline underline-offset-2">
              Show every day
            </button>
          </p>
        )}

        <section className="space-y-4">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel">Coming up</h2>
          {upcoming.length === 0 ? <p className="font-body text-sm text-steel">Nothing scheduled. Add the next one with + New.</p> : byDay(upcoming)}
        </section>
        {recent.length > 0 && (
          <section className="space-y-4">
            <h2 className="font-display uppercase text-sm tracking-wide text-steel">Recent</h2>
            {byDay(recent)}
          </section>
        )}
      </div>

      <div className={`min-w-0 @4xl:sticky @4xl:top-4 ${open ? "hidden @4xl:block" : ""}`}>
        {open ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-display uppercase text-xs tracking-wide text-steel">{open.kind === "event" ? "Event · free" : "Group session · 1 session"}</p>
              <button type="button" onClick={() => setOpenId(null)} className="font-body text-xs text-steel underline underline-offset-2">
                Close
              </button>
            </div>
            {detail(open)}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-1" role="radiogroup" aria-label="What to add">
              <button type="button" role="radio" aria-checked={newKind === "event"} onClick={() => setNewKind("event")} className={chip(newKind === "event")}>
                Event · free
              </button>
              <button type="button" role="radio" aria-checked={newKind === "session"} onClick={() => setNewKind("session")} className={chip(newKind === "session")}>
                Group session · 1 session
              </button>
            </div>
            {newKind === "event" ? (
              <GroupEventForm groups={[{ id: groupId, name: groupName }]} fixedGroupId={groupId} timezone={timezone} />
            ) : (
              <GroupSessionForm groupId={groupId} timezone={timezone} nowIso={nowIso} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
