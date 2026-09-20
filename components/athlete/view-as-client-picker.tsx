"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { X, Search, Dumbbell } from "lucide-react";
import { clientActivityStatus } from "@/lib/client-activity-status";
import { computeQuietTier, QUIET_TIER_LABEL } from "@/lib/quiet-client-tier";
import { initialsOf } from "@/lib/initials";

interface ClientOption {
  id: string;
  fullName: string;
  groupId: string;
  avatarUrl: string | null;
  lastWorkoutAt: string | null;
  trainingDays: number[] | null;
}

interface CoachedGroupOption {
  groupId: string;
  name: string;
}

// Full-screen, coach-wide (not scoped to one group) — a coach may have
// clients spread across several groups, so this lists every athlete they
// coach anywhere, same shape FitPros' own "View As Client" picker uses.
// Also doubles as the entry point for a coach logging their OWN workouts
// (a real, common case — solo/hybrid trainers train themselves too): no
// dedicated "client" record is needed for this, since "acting as" myself
// in a group I already coach resolves correctly under existing RLS
// (athlete_id = auth.uid() already satisfies every write policy).
export function ViewAsClientPicker({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [myGroups, setMyGroups] = useState<CoachedGroupOption[] | null>(null);
  const [pickingOwnGroup, setPickingOwnGroup] = useState(false);
  const [query, setQuery] = useState("");
  const [switching, setSwitching] = useState(false);
  // overnight_comprehensive_polish_pass_sept19_20.md, finding #2 — same
  // real-impersonation confirm step as spot-clients-groups-panel.tsx's
  // roster tap, applied here too since this screen reaches the identical
  // action (real account impersonation) through the identical endpoint.
  // Not needed for "Log My Own Workout"/picking one's own group — that's
  // the coach acting as themselves, no identity/attribution risk.
  const [pendingClient, setPendingClient] = useState<ClientOption | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: coachedGroups } = await supabase
        .from("group_memberships")
        .select("group_id, groups ( name )")
        .eq("profile_id", user.id)
        .eq("role", "coach");
      const groupIds = (coachedGroups ?? []).map((g: any) => g.group_id);
      if (!cancelled) {
        setMyGroups(
          (coachedGroups ?? []).map((g: any) => ({ groupId: g.group_id, name: g.groups?.name ?? "Group" }))
        );
      }
      if (groupIds.length === 0) {
        if (!cancelled) setClients([]);
        return;
      }

      const { data } = await supabase
        .from("group_memberships")
        .select("group_id, profile_id, profiles ( id, full_name, avatar_url )")
        .in("group_id", groupIds)
        .eq("role", "athlete");

      if (cancelled) return;
      const seen = new Set<string>();
      const rows: { id: string; fullName: string; groupId: string; avatarUrl: string | null }[] = [];
      for (const row of (data ?? []) as any[]) {
        const id = row.profiles?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rows.push({
          id,
          fullName: row.profiles?.full_name ?? "Client",
          groupId: row.group_id,
          avatarUrl: row.profiles?.avatar_url ?? null,
        });
      }

      // Same live-glance data the mobile roster's own cards already show
      // (coach-roster-mobile.tsx) — reusing that established pattern
      // rather than inventing new fields for this grid.
      const athleteIds = rows.map((r) => r.id);
      const [{ data: logRows }, { data: programRows }] =
        athleteIds.length > 0
          ? await Promise.all([
              supabase
                .from("workout_logs")
                .select("athlete_id, created_at")
                .in("athlete_id", athleteIds)
                .order("created_at", { ascending: false }),
              supabase
                .from("programs")
                .select("athlete_id, training_days")
                .eq("is_active", true)
                .in("athlete_id", athleteIds),
            ])
          : [{ data: [] }, { data: [] }];

      const lastByAthlete = new Map<string, string>();
      for (const row of logRows ?? []) {
        if (!lastByAthlete.has(row.athlete_id)) lastByAthlete.set(row.athlete_id, row.created_at);
      }
      const trainingDaysByAthlete = new Map<string, number[] | null>();
      for (const row of programRows ?? []) {
        trainingDaysByAthlete.set(row.athlete_id, row.training_days ?? null);
      }

      const options: ClientOption[] = rows.map((r) => ({
        ...r,
        lastWorkoutAt: lastByAthlete.get(r.id) ?? null,
        trainingDays: trainingDaysByAthlete.get(r.id) ?? null,
      }));
      options.sort((a, b) => a.fullName.localeCompare(b.fullName));
      if (!cancelled) setClients(options);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  async function actAs(athleteId: string, groupId: string) {
    if (switching) return;
    setSwitching(true);
    await fetch("/api/coach/act-as", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ athleteId, groupId }),
    });
    onClose();
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  function selectClient(client: ClientOption) {
    if (switching) return;
    setPendingClient(client);
  }

  async function confirmSelectClient() {
    if (!pendingClient) return;
    await actAs(pendingClient.id, pendingClient.groupId);
  }

  async function logMyOwnWorkout() {
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const groups = myGroups ?? [];
    if (groups.length === 1) {
      await actAs(user.id, groups[0].groupId);
      return;
    }
    setPickingOwnGroup(true);
  }

  async function selectOwnGroup(groupId: string) {
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    await actAs(user.id, groupId);
  }

  const filtered = (clients ?? []).filter((c) =>
    c.fullName.toLowerCase().includes(query.trim().toLowerCase())
  );

  if (pendingClient) {
    return (
      <div className="fixed inset-0 z-40 bg-graphite text-chalk font-body flex flex-col">
        <header className="px-5 pt-8 pb-4 border-b border-steel/20 flex items-center justify-between gap-3">
          <h1 className="font-display font-bold text-2xl uppercase leading-none">View as {pendingClient.fullName}?</h1>
          <button
            type="button"
            onClick={() => setPendingClient(null)}
            aria-label="Cancel"
            className="text-steel active:text-rust"
          >
            <X className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </header>
        <p className="font-body text-sm text-steel px-5 pt-4 max-w-[60ch]">
          You&apos;ll see their real data, and anything you log from here on is attributed to them —
          until you exit this view.
        </p>
        <div className="px-5 pt-6 flex items-center gap-3">
          <button
            type="button"
            disabled={switching}
            onClick={confirmSelectClient}
            className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
          >
            View as {pendingClient.fullName}
          </button>
          <button
            type="button"
            disabled={switching}
            onClick={() => setPendingClient(null)}
            className="font-body text-sm text-steel disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (pickingOwnGroup) {
    return (
      <div className="fixed inset-0 z-40 bg-graphite text-chalk font-body flex flex-col">
        <header className="px-5 pt-8 pb-4 border-b border-steel/20 flex items-center justify-between gap-3">
          <h1 className="font-display font-bold text-2xl uppercase leading-none">Log My Own Workout</h1>
          <button type="button" onClick={onClose} aria-label="Close" className="text-steel active:text-rust">
            <X className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </header>
        <p className="font-body text-sm text-steel px-5 pt-4">Which group&apos;s program?</p>
        <div className="flex-1 overflow-y-auto">
          {(myGroups ?? []).map((g) => (
            <button
              key={g.groupId}
              type="button"
              disabled={switching}
              onClick={() => selectOwnGroup(g.groupId)}
              className="w-full text-left px-5 py-4 border-b border-steel/10 font-body text-base disabled:opacity-50 active:bg-surface/60"
            >
              {g.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 bg-graphite text-chalk font-body flex flex-col">
      <header className="px-5 pt-8 pb-4 border-b border-steel/20 flex items-center justify-between gap-3">
        <h1 className="font-display font-bold text-2xl uppercase leading-none">View as Client</h1>
        <button type="button" onClick={onClose} aria-label="Close" className="text-steel active:text-rust">
          <X className="w-5 h-5" strokeWidth={2.5} />
        </button>
      </header>

      {myGroups !== null && myGroups.length > 0 && (
        <button
          type="button"
          disabled={switching}
          onClick={logMyOwnWorkout}
          className="w-full text-left px-5 py-4 border-b border-steel/20 font-body text-base flex items-center gap-2.5 text-rust disabled:opacity-50 active:bg-surface/60"
        >
          <Dumbbell className="w-4 h-4 shrink-0" strokeWidth={2.25} />
          Log My Own Workout
        </button>
      )}

      <div className="px-5 py-3 border-b border-steel/20 flex items-center gap-2">
        <Search className="w-4 h-4 text-steel shrink-0" />
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="flex-1 h-9 bg-transparent text-chalk font-body text-sm focus:outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {clients === null && (
          <p className="font-body text-sm text-steel px-2 py-4">Loading…</p>
        )}
        {clients?.length === 0 && (
          <p className="font-body text-sm text-steel px-2 py-4">No clients yet.</p>
        )}
        {/* Grid of live client cards — replaces the old flat name list,
            per Ron's own "just replaces the list" framing. Same
            glanceable-status data coach-roster-mobile.tsx's own rows
            already show (activity dot + quiet-tier label), not new
            fields, so a coach who's used that roster already recognizes
            what these mean at a glance. */}
        <div className="grid grid-cols-2 gap-2.5 pt-3">
          {filtered.map((c) => {
            const status = clientActivityStatus(c.lastWorkoutAt);
            const tier = computeQuietTier({
              lastLoggedAt: c.lastWorkoutAt ? new Date(c.lastWorkoutAt) : null,
              now: new Date(),
              trainingDays: c.trainingDays,
            });
            return (
              <button
                key={c.id}
                type="button"
                disabled={switching}
                onClick={() => selectClient(c)}
                className="min-w-0 flex flex-col items-center gap-2 p-3 border border-steel/20 rounded-token-lg disabled:opacity-50 active:bg-surface/60 active:border-rust/50 transition-colors"
              >
                {c.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.avatarUrl} alt="" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-graphite border border-steel/30 flex items-center justify-center">
                    <span className="font-display text-sm text-chalk">{initialsOf(c.fullName)}</span>
                  </div>
                )}
                <p className="font-body text-sm text-chalk truncate w-full min-w-0 text-center">{c.fullName}</p>
                <p className="w-full min-w-0 font-body text-[11px] text-steel flex items-center justify-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dotClass}`} />
                  <span className="truncate min-w-0">{tier !== "none" ? QUIET_TIER_LABEL[tier] : status.text}</span>
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
