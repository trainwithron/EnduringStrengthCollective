"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { SUB_GOALS_EMPTY, SUB_GOALS_HEADING, nextSubGoalStatus, subGoalPill, visibleSubGoals, type SubGoalAction, type SubGoalView } from "@/lib/sub-goals";

// "Smaller goals": on the client's goal page and on the coach's view of that client. Either side adds one; the other side agrees or says not now; an agreed one can be marked done. Nothing here changes
// a program or a nutrition target.
export function SubGoalsSection({
  groupId,
  athleteId,
  viewerId,
  otherName,
  items,
  heading = SUB_GOALS_HEADING,
  mainGoalForm,
}: {
  groupId: string;
  athleteId: string;
  viewerId: string;
  otherName: string;
  items: SubGoalView[];
  // The coach's view calls the section "Goals" and passes the existing main-goal suggestion form: the one button then offers both (a smaller goal, or their main goal).
  heading?: string;
  mainGoalForm?: ReactNode;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [suggestingMain, setSuggestingMain] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = visibleSubGoals(items);

  async function add() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy("add");
    setError(null);
    const { error: insertError } = await createBrowserClient()
      .from("client_sub_goals")
      .insert({ athlete_id: athleteId, group_id: groupId, title: t.slice(0, 120), target_date: date || null, proposed_by: viewerId });
    setBusy(null);
    if (insertError) {
      setError("Couldn't add that. Try again.");
      return;
    }
    setTitle("");
    setDate("");
    setAdding(false);
    router.refresh();
  }

  async function act(id: string, action: SubGoalAction) {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/sub-goals/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error("failed");
      router.refresh();
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const small = "inline-flex items-center justify-center min-h-11 px-4 font-body text-sm border";
  return (
    <section aria-label={heading} className="border border-steel/20 p-4 mb-6">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">{heading}</h2>
      {shown.length === 0 ? (
        <p className="font-body text-sm text-steel">{SUB_GOALS_EMPTY}</p>
      ) : (
        <ul className="divide-y divide-steel/15">
          {shown.map((g) => {
            const canAnswer = nextSubGoalStatus({ status: g.status, proposedBy: g.proposedBy, actorId: viewerId, action: "agree" }) !== null;
            const canFinish = g.status === "agreed";
            return (
              <li key={g.id} className="py-3">
                <p className={`font-body text-base ${g.status === "done" ? "text-steel line-through" : "text-chalk"}`}>{g.title}</p>
                <p className="font-body text-xs text-steel mt-0.5">
                  {subGoalPill({ status: g.status, proposedBy: g.proposedBy, viewerId, otherName })}
                  {g.targetDate ? ` · by ${g.targetDate}` : ""}
                </p>
                {(canAnswer || canFinish) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canAnswer && (
                      <>
                        <button type="button" disabled={busy !== null} onClick={() => act(g.id, "agree")} className={`${small} bg-rust text-graphite border-rust disabled:opacity-40`}>
                          Agree
                        </button>
                        <button type="button" disabled={busy !== null} onClick={() => act(g.id, "decline")} className={`${small} text-chalk border-steel/40 disabled:opacity-40`}>
                          Not now
                        </button>
                      </>
                    )}
                    {canFinish && (
                      <button type="button" disabled={busy !== null} onClick={() => act(g.id, "done")} className={`${small} text-chalk border-steel/40 disabled:opacity-40`}>
                        Done
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <div className="mt-3 space-y-2">
          <label className="block font-body text-xs text-steel">
            Smaller goal
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Deadlift 315" className="mt-1 w-full min-h-11 bg-graphite border border-steel/40 px-3 text-chalk text-base" />
          </label>
          <label className="block font-body text-xs text-steel">
            By when (optional)
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full min-h-11 bg-graphite border border-steel/40 px-3 text-chalk text-base" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={add} disabled={!title.trim() || busy !== null} className={`${small} bg-rust text-graphite border-rust disabled:opacity-40`}>
              Add
            </button>
            <button type="button" onClick={() => setAdding(false)} className={`${small} text-chalk border-steel/40`}>
              Cancel
            </button>
          </div>
        </div>
      ) : suggestingMain ? (
        <div className="mt-3">
          {mainGoalForm}
          <button type="button" onClick={() => setSuggestingMain(false)} className={`${small} text-chalk border-steel/40 mt-2`}>
            Cancel
          </button>
        </div>
      ) : choosing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => { setChoosing(false); setAdding(true); }} className={`${small} text-rust border-rust`}>
            A smaller goal
          </button>
          <button type="button" onClick={() => { setChoosing(false); setSuggestingMain(true); }} className={`${small} text-rust border-rust`}>
            Suggest their main goal
          </button>
          <button type="button" onClick={() => setChoosing(false)} className={`${small} text-chalk border-steel/40`}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => (mainGoalForm ? setChoosing(true) : setAdding(true))} className={`${small} text-rust border-rust mt-3`}>
          {mainGoalForm ? "Add or suggest a goal" : "Add a smaller goal"}
        </button>
      )}
      {error && (
        <p className="font-body text-sm text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
