"use client";

import { readHealthAnswersMany } from "@/lib/health-answers";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createBrowserClient } from "@/lib/supabase/client";
import { confirmDialog } from "@/components/shared/confirm-dialog";
import { loadAssignableClients, type AssignClient } from "@/lib/assign-clients";
import { loadAssignedTo, type AssignedInstance } from "@/lib/program-assigned";
import { assignProgramToClient } from "@/lib/program-duplication";
import { removeProgramMessage } from "@/lib/program-archive";
import { APPROVE_AND_ASSIGN_FAILED, ensureSignedOff } from "@/components/coach/approve-and-assign";
import { assignNotices } from "@/lib/assign-notice";
import { hasFlaggedMusculoskeletalConcern, type ParQAnswer } from "@/lib/athlete-injury-flag";
import { notifyPush } from "@/lib/push-notify";
import { localDateKey } from "@/lib/timezone";
import { useTerm } from "@/components/coach/terminology-provider";
import { assignProgramToGroup, loadAssignableGroups, loadAssignedGroups, type AssignableGroup } from "@/lib/org-programs";

interface PositionOption {
  id: string;
  name: string;
  athleteIds: string[];
}

interface Target {
  athleteId: string;
  name: string;
  destinationGroupId: string | null; // null = the coach's own personal space
  isMe: boolean;
}

// "Assign...": ONE panel for a program. Top: everyone who has their own version of it now, each with Remove (takes it off their profile; their history stays). Below: add people (clients, "Me",
// a position, or everyone in the group) with a start date and one Assign button. Every person gets their OWN independent version (no overlap); the program here stays the one entry.
// An organization program (orgProgram, 0435) lists the organization's clients and, as their own section, its groups: a group gets ONE copy that is that group's program (every member follows it,
// with the group's feed and team sheet). The "everyone in this group" and position choices belong to a group's own program and are not offered for an organization program.
export function ProgramAssignPanel({ programId, programName, groupId, aiDraft, orgProgram = false, onClose, onChanged }: { programId: string; programName: string; groupId: string; aiDraft: boolean; orgProgram?: boolean; onClose: () => void; onChanged: () => void }) {
  const term = useTerm();
  const [assigned, setAssigned] = useState<AssignedInstance[] | null>(null);
  const [clients, setClients] = useState<AssignClient[] | null>(null);
  const [positions, setPositions] = useState<PositionOption[] | null>(null);
  const [groupAthleteIds, setGroupAthleteIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupIsOneOnOne, setGroupIsOneOnOne] = useState(true);
  const [myName, setMyName] = useState("Me");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState(localDateKey());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgGroups, setOrgGroups] = useState<AssignableGroup[] | null>(null);
  const [groupCopies, setGroupCopies] = useState<{ programId: string; groupId: string; groupName: string }[]>([]);

  async function reloadAssigned() {
    setAssigned(await loadAssignedTo(createBrowserClient(), programId, { includeSelf: true }));
    if (orgProgram) setGroupCopies(await loadAssignedGroups(createBrowserClient(), programId));
  }

  useEffect(() => {
    const supabase = createBrowserClient();
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      void reloadAssigned();
      const [list, { data: posRows }, { data: memberRows }, { data: groupRow }, { data: me }] = await Promise.all([
        loadAssignableClients(supabase, user.id, groupId),
        supabase.from("group_positions").select("id, name, sort_order").eq("group_id", groupId).order("sort_order"),
        supabase.from("group_memberships").select("profile_id, position_id").eq("group_id", groupId).eq("role", "athlete"),
        supabase.from("groups").select("name, group_kind").eq("id", groupId).maybeSingle(),
        supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      ]);
      setClients(list);
      if (orgProgram) setOrgGroups(await loadAssignableGroups(supabase, user.id, groupId));
      setGroupName((groupRow?.name as string | undefined) ?? "");
      setGroupIsOneOnOne((groupRow?.group_kind as string | undefined) === "one_on_one");
      setMyName(((me?.full_name as string | undefined) ?? "").trim() || "Me");
      const members = (memberRows ?? []) as { profile_id: string; position_id: string | null }[];
      setGroupAthleteIds(members.map((m) => m.profile_id));
      setPositions(
        (posRows ?? [])
          .map((p) => ({ id: p.id as string, name: p.name as string, athleteIds: members.filter((m) => m.position_id === p.id).map((m) => m.profile_id) }))
          .filter((p) => p.athleteIds.length > 0)
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, groupId, orgProgram]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !document.querySelector('[role="alertdialog"]')) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const alreadyAssigned = useMemo(() => new Set((assigned ?? []).map((a) => a.athleteId)), [assigned]);
  const q = query.trim().toLowerCase();
  const shownClients = (clients ?? []).filter((c) => !q || c.fullName.toLowerCase().includes(q));
  const shownPositions = orgProgram ? [] : (positions ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  const showGroup = !orgProgram && !groupIsOneOnOne && groupAthleteIds.length > 0 && (!q || groupName.toLowerCase().includes(q));
  const groupHasCopy = new Set(groupCopies.map((c) => c.groupId));
  const shownGroups = (orgGroups ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));
  const selectedGroups = (orgGroups ?? []).filter((g) => selected.has(`g:${g.id}`) && !groupHasCopy.has(g.id));
  const showMe = !q || "me".includes(q) || myName.toLowerCase().includes(q);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // The people the selection stands for, once: a person chosen twice (alone and through a position) gets one version, and anyone who already has it is left out.
  function targets(): Target[] {
    const byId = new Map((clients ?? []).map((c) => [c.id, c]));
    const out = new Map<string, Target>();
    const add = (id: string) => {
      const c = byId.get(id);
      if (c && !alreadyAssigned.has(id)) out.set(id, { athleteId: id, name: c.fullName, destinationGroupId: c.destinationGroupId, isMe: false });
    };
    for (const key of selected) {
      if (key === "me") continue;
      if (key === "group") groupAthleteIds.forEach(add);
      else if (key.startsWith("p:")) positions?.find((p) => `p:${p.id}` === key)?.athleteIds.forEach(add);
      else if (key.startsWith("c:")) add(key.slice(2));
    }
    return [...out.values()];
  }

  const list = targets();
  const count = list.length + (selected.has("me") ? 1 : 0) + selectedGroups.length;

  // What is on file NOW for the people about to receive this program (age, birthdate missing, a flagged health concern): the coach is told before it goes, not only when it was built.
  const [notices, setNotices] = useState<string[]>([]);
  const listKey = list.map((t) => t.athleteId).sort().join(",");
  useEffect(() => {
    const ids = listKey ? listKey.split(",") : [];
    if (ids.length === 0) {
      setNotices([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error: intakeError } = await createBrowserClient().from("client_intake").select("athlete_id, date_of_birth").in("athlete_id", ids);
      const screening = await readHealthAnswersMany(createBrowserClient(), ids);
      if (cancelled) return;
      // A failed read says nothing (it must not claim every client has no birthdate).
      if (intakeError) {
        setNotices([]);
        return;
      }
      // The screening could not be read: say so, never read it as "nobody has a concern".
      if (screening.failed) {
        setNotices(["The health screening could not be checked just now. Look at each client's screening before assigning."]);
        return;
      }
      const byId = new Map(((data ?? []) as { athlete_id: string; date_of_birth: string | null }[]).map((r) => [r.athlete_id, r]));
      // The coach's own decisions on flagged screenings (best effort: without them the other notes still show).
      const { data: ackRows } = await createBrowserClient().from("athlete_injury_flag_acknowledgements").select("athlete_id, decision").in("athlete_id", ids);
      if (cancelled) return;
      const holdIds = new Set(((ackRows ?? []) as { athlete_id: string; decision: string | null }[]).filter((r) => r.decision === "hold").map((r) => r.athlete_id));
      const names = new Map((clients ?? []).map((c) => [c.id, c.fullName]));
      setNotices(
        assignNotices(
          ids.map((id) => ({
            name: names.get(id) ?? "A client",
            dateOfBirth: byId.get(id)?.date_of_birth ?? null,
            parqFlagged: hasFlaggedMusculoskeletalConcern((screening.answers.get(id) as ParQAnswer[]) ?? []),
            onHold: holdIds.has(id),
          }))
        )
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [listKey, clients]);

  async function removeOne(a: AssignedInstance) {
    if (busy) return;
    if (!(await confirmDialog({ message: removeProgramMessage(programName, a.athleteName), confirmLabel: "Remove" }))) return;
    setBusy(true);
    setError(null);
    // Inactive and removed in the same update: the database refuses a removed program that is still active.
    const { data, error: updateError } = await createBrowserClient().from("programs").update({ is_active: false, archived_at: new Date().toISOString() }).eq("id", a.instanceId).select("id");
    setBusy(false);
    if (updateError || !data || data.length === 0) {
      setError("Couldn't remove it. Try again.");
      return;
    }
    await reloadAssigned();
    onChanged();
  }

  async function assign() {
    if (busy || count === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    // An AI draft: the click on Assign IS the approval (the existing sign-off runs first, without making the original active).
    if ((await ensureSignedOff({ aiDraft, programId })) === "failed") {
      setBusy(false);
      setError(APPROVE_AND_ASSIGN_FAILED);
      return;
    }
    const supabase = createBrowserClient();
    const all: Target[] = [...list];
    if (selected.has("me")) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) all.unshift({ athleteId: user.id, name: myName, destinationGroupId: null, isMe: true });
    }
    let ok = 0;
    const failed: string[] = [];
    let lastError: string | null = null;
    // Each chosen group gets its own copy (that group's program).
    let groupsOk = 0;
    if (selectedGroups.length > 0) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      for (const g of selectedGroups) {
        setProgress(`Assigning to ${g.name}…`);
        const r = user ? await assignProgramToGroup(supabase, { sourceProgramId: programId, groupId: g.id, createdBy: user.id, startDate: startDate || undefined }) : { error: "You are signed out." };
        if ("error" in r) {
          failed.push(g.name);
          lastError = r.error;
        } else groupsOk++;
      }
    }
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      setProgress(`Assigning ${i + 1} of ${all.length}…`);
      let dest = t.destinationGroupId;
      if (t.isMe) {
        // The coach's own training lives in their personal space (one set that follows them into every organization), made the first time it is needed.
        const { data: spaceId, error: spaceError } = await supabase.rpc("ensure_personal_space");
        if (!spaceId) {
          failed.push(t.name);
          lastError = spaceError?.message?.includes("Only coaches") ? "Only coaches have a personal space." : "Couldn't set that up. Try again.";
          continue;
        }
        dest = spaceId as string;
      }
      const result = await assignProgramToClient(supabase, { sourceProgramId: programId, destinationGroupId: dest as string, athleteId: t.athleteId, startDate: startDate || undefined });
      if ("error" in result) {
        failed.push(t.name);
        lastError = result.error;
        continue;
      }
      ok++;
      if (!t.isMe) notifyPush(t.athleteId, "New program", `Your coach assigned you a new program: ${programName}`, `/groups/${dest}/programs/${result.programId}`);
    }
    setBusy(false);
    setProgress(null);
    setSelected(new Set());
    const parts = [ok > 0 ? `${ok} ${ok === 1 ? "person" : "people"}` : null, groupsOk > 0 ? `${groupsOk} ${groupsOk === 1 ? "group" : "groups"}` : null].filter(Boolean);
    setMessage(parts.length > 0 ? `Assigned to ${parts.join(" and ")}.` : null);
    if (failed.length > 0) setError(`Couldn't assign to ${failed.join(", ")}${lastError ? `: ${lastError}` : "."}`);
    await reloadAssigned();
    onChanged();
  }

  const row = "flex items-center gap-3 min-h-11 px-3 py-1.5 font-body text-sm text-chalk cursor-pointer hover:bg-graphite/50";
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={`Assign ${programName}`} className="w-full max-w-lg bg-surface border border-steel/30 shadow-xl mt-8">
        <div className="flex items-start justify-between gap-3 px-4 pt-4">
          <h2 className="font-display font-bold text-lg uppercase leading-tight min-w-0 break-words">Assign &ldquo;{programName}&rdquo;</h2>
          <button type="button" onClick={onClose} className="min-h-11 px-2 font-body text-sm text-steel shrink-0">
            Close
          </button>
        </div>

        <div className="px-4 pt-3">
          <p className="font-body text-xs text-steel uppercase tracking-wide">Assigned to{assigned ? ` (${assigned.length})` : ""}</p>
          {assigned === null ? (
            <p className="font-body text-sm text-steel py-2">Loading…</p>
          ) : assigned.length === 0 ? (
            <p className="font-body text-sm text-steel py-2">Not assigned to anyone yet.</p>
          ) : (
            <ul className="divide-y divide-steel/15 border-y border-steel/15 mt-1 max-h-48 overflow-y-auto">
              {assigned.map((a) => (
                <li key={a.instanceId} className="flex items-center justify-between gap-3 px-1 min-h-11">
                  <span className="font-body text-sm text-chalk truncate">
                    {a.athleteName}
                    {a.startDate ? <span className="text-steel text-xs"> · starts {a.startDate}</span> : null}
                  </span>
                  <button type="button" disabled={busy} onClick={() => void removeOne(a)} className="min-h-11 px-2 font-body text-xs text-rust disabled:opacity-40 shrink-0">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {orgProgram && groupCopies.length > 0 && (
          <p className="px-4 pt-2 font-body text-xs text-steel" data-assigned-groups>
            Groups with their own copy: {groupCopies.map((c) => c.groupName).join(", ")}
          </p>
        )}

        <div className="px-4 pt-4 pb-4">
          <p className="font-body text-xs text-steel uppercase tracking-wide">Add</p>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${term("client", "plural")}, positions or groups`}
            aria-label={`Search ${term("client", "plural")}, positions or groups`}
            className="w-full min-h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
          />
          <div className="mt-2 max-h-60 overflow-y-auto border border-steel/15">
            {showMe && (
              <label className={row}>
                <input type="checkbox" checked={selected.has("me")} onChange={() => toggle("me")} />
                <span className="truncate">{myName === "Me" ? "Me" : `${myName} (you)`}</span>
              </label>
            )}
            {clients === null && <p className="font-body text-xs text-steel px-3 py-2">Loading…</p>}
            {shownClients.map((c) => {
              const has = alreadyAssigned.has(c.id);
              return (
                <label key={c.id} className={`${row} ${has ? "opacity-50 cursor-default" : ""}`}>
                  <input type="checkbox" disabled={has} checked={selected.has(`c:${c.id}`)} onChange={() => toggle(`c:${c.id}`)} />
                  <span className="truncate">
                    {c.fullName}
                    {has ? <span className="text-steel text-xs"> · has it</span> : c.hint ? <span className="text-steel text-xs"> · {c.hint}</span> : null}
                  </span>
                </label>
              );
            })}
            {shownPositions.map((p) => (
              <label key={p.id} className={row}>
                <input type="checkbox" checked={selected.has(`p:${p.id}`)} onChange={() => toggle(`p:${p.id}`)} />
                <span className="truncate">
                  {p.name} <span className="text-steel text-xs">· position, {p.athleteIds.length}</span>
                </span>
              </label>
            ))}
            {orgProgram && shownGroups.length > 0 && (
              <>
                <p className="px-3 pt-2 pb-1 font-body text-xs text-steel uppercase tracking-wide" data-assign-groups>
                  Groups
                </p>
                {shownGroups.map((g) => {
                  const has = groupHasCopy.has(g.id);
                  return (
                    <label key={g.id} className={`${row} ${has ? "opacity-50 cursor-default" : ""}`}>
                      <input type="checkbox" disabled={has} checked={selected.has(`g:${g.id}`)} onChange={() => toggle(`g:${g.id}`)} />
                      <span className="truncate">
                        {g.name}
                        <span className="text-steel text-xs"> · {has ? "has it" : "everyone in the group follows it"}</span>
                      </span>
                    </label>
                  );
                })}
              </>
            )}
            {showGroup && (
              <label className={row}>
                <input type="checkbox" checked={selected.has("group")} onChange={() => toggle("group")} />
                <span className="truncate">
                  Everyone in {groupName} <span className="text-steel text-xs">· {groupAthleteIds.length}</span>
                </span>
              </label>
            )}
            {clients !== null && shownClients.length === 0 && shownPositions.length === 0 && shownGroups.length === 0 && !showGroup && !showMe && <p className="font-body text-xs text-steel px-3 py-2">No one matches.</p>}
          </div>

          <label className="block mt-3 font-body text-xs text-steel">
            Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full min-h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust" />
          </label>

          {notices.length > 0 && (
            <div className="mt-3 border border-rust/40 bg-rust/5 p-3" role="note">
              {notices.map((n, i) => (
                <p key={i} className="font-body text-xs text-chalk leading-snug">
                  {n}
                </p>
              ))}
            </div>
          )}

          <button type="button" disabled={busy || count === 0} onClick={() => void assign()} className="w-full min-h-11 mt-3 bg-rust text-graphite font-display font-bold uppercase tracking-wide disabled:opacity-40">
            {busy ? progress ?? "Assigning…" : count > 0 ? `Assign to ${count}` : "Assign"}
          </button>
          {message && (
            <p className="font-body text-sm text-chalk mt-2" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="font-body text-xs text-rust mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
