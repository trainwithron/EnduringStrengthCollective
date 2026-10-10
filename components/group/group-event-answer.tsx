"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { answerLabel, eventAnswer, type EventAnswer } from "@/lib/group-events";

interface EventRow {
  id: string;
  title: string;
  start_at: string;
  status: string;
  location_note: string | null;
  note: string | null;
  capacity: number | null;
}

async function callEvent(eventId: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; status?: string }> {
  try {
    const res = await fetch(`/api/group-events/${eventId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, status: data.status } : { ok: false, error: data.error ?? "That didn't work. Try again." };
  } catch {
    return { ok: false, error: "That didn't work. Try again." };
  }
}

// In / Out for one group event, loading its own state (so it can sit on a feed post or a calendar list). A member answers; a coach sees who is In instead. Out is a
// real answer, different from not having answered yet. It never costs a session.
export function EventAnswerButtons({
  eventId,
  athleteId,
  isCoach = false,
  timezone,
  showDetails = false,
}: {
  eventId: string;
  athleteId: string | null;
  isCoach?: boolean;
  timezone?: string;
  showDetails?: boolean;
}) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [answer, setAnswer] = useState<EventAnswer>("none");
  const [people, setPeople] = useState<{ name: string; status: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data: ev } = await supabase.from("group_sessions").select("id, title, start_at, status, location_note, note, capacity").eq("id", eventId).maybeSingle();
    setEvent((ev as EventRow | null) ?? null);
    if (isCoach) {
      const { data: rows } = await supabase.from("group_session_attendees").select("status, profiles!group_session_attendees_athlete_id_fkey ( full_name )").eq("group_session_id", eventId);
      setPeople(((rows ?? []) as any[]).map((r) => ({ name: r.profiles?.full_name ?? "A member", status: r.status as string })));
    } else if (athleteId) {
      const { data: mine } = await supabase.from("group_session_attendees").select("status").eq("group_session_id", eventId).eq("athlete_id", athleteId).maybeSingle();
      setAnswer(eventAnswer((mine as { status: string } | null)?.status));
    }
    setLoaded(true);
  }, [eventId, athleteId, isCoach]);

  useEffect(() => {
    load().catch(() => setLoaded(true));
  }, [load]);

  async function respond(action: "in" | "out") {
    if (busy || !athleteId) return;
    setBusy(true);
    setError(null);
    const result = await callEvent(eventId, { action, athleteId });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That didn't work. Try again.");
      return;
    }
    setAnswer(action === "out" ? "out" : eventAnswer(result.status));
  }

  if (!loaded) return null;
  if (!event) return null;
  const started = new Date(event.start_at).getTime() <= Date.now();
  const cancelled = event.status === "cancelled";
  const when = formatInTimezone(new Date(event.start_at), timezone, "dateTime");
  const names = (status: string) => people.filter((p) => p.status === status || (status === "joined" && p.status === "attended")).map((p) => p.name);
  const inNames = names("joined");
  const outCount = people.filter((p) => p.status === "cancelled").length;
  const waitingCount = people.filter((p) => p.status === "waitlisted").length;

  return (
    <div className="mt-2 border border-steel/25 p-3" data-testid="group-event-answer">
      {showDetails && (
        <div className="mb-2">
          <p className="font-display uppercase text-sm tracking-wide text-chalk">{event.title}</p>
          <p className="font-body text-xs text-steel">
            {when}
            {event.location_note ? ` · ${event.location_note}` : ""}
          </p>
          {event.note && <p className="font-body text-xs text-steel mt-1">{event.note}</p>}
        </div>
      )}
      {cancelled ? (
        <p className="font-body text-sm text-steel">This event was cancelled.</p>
      ) : isCoach ? (
        <div className="font-body text-sm text-chalk">
          <p>
            {inNames.length} in{waitingCount > 0 ? `, ${waitingCount} waiting` : ""}, {outCount} out
          </p>
          {inNames.length > 0 && <p className="text-xs text-steel mt-1">In: {inNames.join(", ")}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void respond("in")}
            disabled={busy || started || !athleteId}
            aria-pressed={answer === "in" || answer === "there"}
            className={`min-h-11 px-5 font-body text-sm font-medium border disabled:opacity-40 ${answer === "in" || answer === "there" ? "bg-rust text-graphite border-rust" : "border-steel/40 text-chalk"}`}
          >
            In
          </button>
          <button
            type="button"
            onClick={() => void respond("out")}
            disabled={busy || started || !athleteId}
            aria-pressed={answer === "out"}
            className={`min-h-11 px-5 font-body text-sm font-medium border disabled:opacity-40 ${answer === "out" ? "bg-steel/30 text-chalk border-steel/60" : "border-steel/40 text-chalk"}`}
          >
            Out
          </button>
          <span className="font-body text-xs text-steel" role="status">
            {started ? "This event has started." : answerLabel(answer)}
          </span>
        </div>
      )}
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// The member's calendar list: the coming events of EVERY group they are in (row security shows a member only their own groups' events), each with In / Out and
// their current answer.
export function UpcomingGroupEvents({ athleteId, timezone }: { athleteId: string; timezone?: string }) {
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await createBrowserClient()
        .from("group_sessions")
        .select("id")
        .eq("kind", "event")
        .eq("status", "scheduled")
        .gte("start_at", new Date().toISOString())
        .order("start_at", { ascending: true })
        .limit(10);
      if (!cancelled) setIds(((data ?? []) as { id: string }[]).map((r) => r.id));
    })().catch(() => !cancelled && setIds([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ids || ids.length === 0) return null;
  return (
    <section className="px-5 pt-6" aria-label="Group events">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Group events</h2>
      {ids.map((id) => (
        <EventAnswerButtons key={id} eventId={id} athleteId={athleteId} timezone={timezone} showDetails />
      ))}
    </section>
  );
}
