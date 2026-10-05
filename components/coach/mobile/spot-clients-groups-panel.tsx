"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dumbbell, Plus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { actAsSelfInGroup } from "@/lib/act-as-self";
import { clientActivityStatus } from "@/lib/client-activity-status";
import { computeQuietTier, QUIET_TIER_LABEL } from "@/lib/quiet-client-tier";
import { initialsOf } from "@/lib/initials";

// the_spot_dropdown_widget_redesign_sept16.md "REVISED 2026-09-19" — the
// Spot's new center/default panel, replacing the old business-glance-as-
// home. Real gap this closes (the nav-architecture audit that drove this
// rework): no root-level Groups index existed anywhere in the app, View-
// as was buried behind a dropdown, and there was no standalone "Create
// Group" action. Two SEPARATE lists, not merged — Clients (tap = View-as
// that athlete, reusing the exact fetch/act-as logic that used to live in
// ViewAsClientPicker) and Groups (tap = switch into that group as coach,
// reusing GroupSwitcher's own fetch/switch/create logic, mobile-styled).
//
// Scoped per Ron's 2026-10-05 structure decisions: only organizations the
// coach actually COACHES in appear here (an org he merely owns/administers
// never does), each org is its own world, the org switcher shows only for
// a coach in 2+ orgs, one-on-one clients are listed first as people, then
// the team/social groups, and nothing is listed twice (a 1:1 client's own
// solo group is not also a "group").

type GroupKind = "one_on_one" | "social" | "team";
const GROUP_KIND_LABELS: Record<GroupKind, string> = { one_on_one: "1-on-1", social: "Social", team: "Groups" };
const GROUP_KIND_ORDER: GroupKind[] = ["team", "social", "one_on_one"];

interface ClientOption {
  id: string;
  orgId: string;
  fullName: string;
  groupId: string;
  avatarUrl: string | null;
  lastWorkoutAt: string | null;
  trainingDays: number[] | null;
}

interface CoachedGroupOption {
  id: string;
  orgId: string;
  name: string;
  focusTag: string | null;
  kind: GroupKind;
}

const SELECTED_ORG_KEY = "spot-selected-org";

async function getCurrentOrgId(supabase: ReturnType<typeof createBrowserClient>, groupId: string): Promise<string | null> {
  const { data } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
  return data?.organization_id ?? null;
}

export function SpotClientsGroupsPanel({ groupId, onNavigated }: { groupId: string; onNavigated: () => void }) {
  const router = useRouter();
  const [clients, setClients] = useState<ClientOption[] | null>(null);
  const [groups, setGroups] = useState<CoachedGroupOption[] | null>(null);
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [pickingOwnGroup, setPickingOwnGroup] = useState(false);
  // overnight_comprehensive_polish_pass_sept19_20.md, finding #2 — this
  // tap starts real account impersonation (the coach sees and writes as
  // this client from here on, until they exit), a categorically
  // different action from desktop's "Client Profile" button, which only
  // opens a read-only page. A one-tap confirm, matching Ron's own call.
  const [pendingClient, setPendingClient] = useState<ClientOption | null>(null);
  const [myGroups, setMyGroups] = useState<{ groupId: string; name: string }[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupKind, setNewGroupKind] = useState<GroupKind>("team");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [{ data: coachedGroups }, currentOrgId] = await Promise.all([
        supabase
          .from("group_memberships")
          .select("group_id, groups ( id, name, focus_tag, group_kind, organization_id, organizations ( name ) )")
          .eq("profile_id", user.id)
          .eq("role", "coach"),
        getCurrentOrgId(supabase, groupId),
      ]);

      if (!cancelled) setMyGroups((coachedGroups ?? []).map((g: any) => ({ groupId: g.group_id, name: g.groups?.name ?? "Group" })));

      // Only groups this person actually coaches, in any org they coach in.
      const orgById = new Map<string, string>();
      const allGroups: CoachedGroupOption[] = [];
      for (const row of (coachedGroups ?? []) as any[]) {
        const g = row.groups;
        if (!g?.organization_id) continue;
        orgById.set(g.organization_id, g.organizations?.name ?? "Organization");
        allGroups.push({ id: g.id, orgId: g.organization_id, name: g.name, focusTag: g.focus_tag ?? null, kind: (g.group_kind ?? "team") as GroupKind });
      }
      const orgList = [...orgById.entries()].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));

      let remembered: string | null = null;
      try {
        remembered = window.localStorage.getItem(SELECTED_ORG_KEY);
      } catch {
        // Storage can be unavailable (private mode) — fall back to the current group's org.
      }
      const preferred = [remembered, currentOrgId].find((id) => id && orgById.has(id)) ?? orgList[0]?.id ?? null;
      if (!cancelled) {
        setOrgs(orgList);
        setSelectedOrgId(preferred);
        setGroups(allGroups.sort((x, y) => x.name.localeCompare(y.name)));
      }

      // Clients = the people in this coach's one-on-one groups (a 1:1
      // client's own group is bookkeeping, not a "group" to list).
      const soloGroups = allGroups.filter((g) => g.kind === "one_on_one");
      if (soloGroups.length === 0) {
        if (!cancelled) setClients([]);
        return;
      }
      const orgByGroup = new Map(soloGroups.map((g) => [g.id, g.orgId]));

      const { data: memberRows } = await supabase
        .from("group_memberships")
        .select("group_id, profile_id, profiles ( id, full_name, avatar_url )")
        .in("group_id", soloGroups.map((g) => g.id))
        .eq("role", "athlete");

      if (cancelled) return;
      const seen = new Set<string>();
      const rows: { id: string; orgId: string; fullName: string; groupId: string; avatarUrl: string | null }[] = [];
      for (const row of (memberRows ?? []) as any[]) {
        const id = row.profiles?.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rows.push({ id, orgId: orgByGroup.get(row.group_id) ?? "", fullName: row.profiles?.full_name ?? "Client", groupId: row.group_id, avatarUrl: row.profiles?.avatar_url ?? null });
      }

      const athleteIds = rows.map((r) => r.id);
      const [{ data: logRows }, { data: programRows }] =
        athleteIds.length > 0
          ? await Promise.all([
              supabase.from("workout_logs").select("athlete_id, created_at").in("athlete_id", athleteIds).order("created_at", { ascending: false }),
              supabase.from("programs").select("athlete_id, training_days").eq("is_active", true).in("athlete_id", athleteIds),
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

      const options: ClientOption[] = rows.map((r) => ({ ...r, lastWorkoutAt: lastByAthlete.get(r.id) ?? null, trainingDays: trainingDaysByAthlete.get(r.id) ?? null }));
      options.sort((a, b) => a.fullName.localeCompare(b.fullName));
      if (!cancelled) setClients(options);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  function requestActAsClient(client: ClientOption) {
    if (busy) return;
    setPendingClient(client);
  }

  // Primary action: the explicit in-person log route (athlete comes from
  // the URL, coach-role checked, "Logging for X", marked coach-logged).
  function logSessionFor(client: ClientOption) {
    if (busy) return;
    onNavigated();
    router.push(`/groups/${client.groupId}/athletes/${client.id}/log`);
  }

  async function confirmActAsClient() {
    if (!pendingClient || busy) return;
    const client = pendingClient;
    setBusy(true);
    await fetch("/api/coach/act-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ athleteId: client.id, groupId: client.groupId }) });
    onNavigated();
    router.push(`/groups/${client.groupId}`);
    router.refresh();
  }

  async function logMyOwnWorkout() {
    if (myGroups.length === 1) {
      await selectOwnGroup(myGroups[0].groupId);
      return;
    }
    setPickingOwnGroup(true);
  }

  async function selectOwnGroup(targetGroupId: string) {
    if (busy) return;
    setBusy(true);
    await actAsSelfInGroup(targetGroupId);
    onNavigated();
    router.push(`/groups/${targetGroupId}`);
    router.refresh();
  }

  async function switchToGroup(targetGroupId: string) {
    if (targetGroupId === groupId || busy) return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const { data: existing } = await supabase.from("group_memberships").select("group_id").eq("group_id", targetGroupId).eq("profile_id", user.id).maybeSingle();
    if (!existing) {
      const { error: insertError } = await supabase.from("group_memberships").insert({ group_id: targetGroupId, profile_id: user.id, role: "coach" });
      if (insertError) {
        setBusy(false);
        setError("Couldn't switch — try again.");
        return;
      }
    }
    onNavigated();
    router.push(`/groups/${targetGroupId}/dashboard`);
  }

  async function handleCreateGroup() {
    const trimmed = newGroupName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setCreating(false);
      return;
    }
    const { data: membership } = selectedOrgId
      ? await supabase.from("organization_memberships").select("organization_id").eq("organization_id", selectedOrgId).eq("profile_id", user.id).maybeSingle()
      : { data: null };
    if (!membership) {
      setCreating(false);
      setError("Couldn't find your organization — try again.");
      return;
    }
    // Generated client-side, not read back via .select() — a fresh group
    // has no group_memberships row yet, so its own membership-gated
    // SELECT policy can't see it immediately after INSERT ... RETURNING.
    const newGroupId = crypto.randomUUID();
    const { error: groupError } = await supabase.from("groups").insert({ id: newGroupId, name: trimmed, created_by: user.id, organization_id: membership.organization_id, group_kind: newGroupKind });
    if (groupError) {
      setCreating(false);
      setError("Couldn't create the group — try again.");
      return;
    }
    await supabase.from("group_memberships").insert({ group_id: newGroupId, profile_id: user.id, role: "coach" });
    onNavigated();
    router.push(`/groups/${newGroupId}/dashboard`);
  }

  const filteredClients = (clients ?? []).filter(
    (c) => c.orgId === selectedOrgId && c.fullName.toLowerCase().includes(query.trim().toLowerCase())
  );
  // Team and social groups only: a one-on-one group is its client, listed above.
  const LISTED_GROUP_KINDS: GroupKind[] = ["team", "social"];
  const groupSections = LISTED_GROUP_KINDS.map((kind) => ({
    kind,
    label: GROUP_KIND_LABELS[kind],
    list: (groups ?? []).filter((g) => g.orgId === selectedOrgId && g.kind === kind),
  }));

  function selectOrg(id: string) {
    setSelectedOrgId(id);
    try {
      window.localStorage.setItem(SELECTED_ORG_KEY, id);
    } catch {
      // Non-fatal.
    }
  }

  if (pendingClient) {
    return (
      <div>
        <p className="font-body text-sm text-chalk mb-1">View as {pendingClient.fullName}?</p>
        <p className="font-body text-xs text-steel mb-4">
          You&apos;ll see their real data, and anything you log from here on is attributed to them — until you
          exit this view.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={confirmActAsClient}
            className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-50"
          >
            View as {pendingClient.fullName}
          </button>
          <button
            type="button"
            disabled={busy}
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
      <div>
        <p className="font-body text-sm text-steel mb-2">Which group&apos;s program?</p>
        {myGroups.map((g) => (
          <button key={g.groupId} type="button" disabled={busy} onClick={() => selectOwnGroup(g.groupId)} className="w-full text-left px-3 py-3 border-b border-steel/10 font-body text-sm disabled:opacity-50 active:bg-surface/60">
            {g.name}
          </button>
        ))}
        <button type="button" onClick={() => setPickingOwnGroup(false)} className="mt-2 font-body text-xs text-steel underline">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {myGroups.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={logMyOwnWorkout}
          className="w-full h-10 border border-rust/40 text-rust font-body text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:bg-rust/5"
        >
          <Dumbbell className="w-4 h-4 shrink-0" strokeWidth={2.25} />
          Log My Own Workout
        </button>
      )}

      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}

      {orgs.length >= 2 && (
        <div className="flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Organization">
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              aria-selected={o.id === selectedOrgId}
              onClick={() => selectOrg(o.id)}
              className={`h-8 px-3 shrink-0 whitespace-nowrap font-body text-xs border ${o.id === selectedOrgId ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"}`}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}

      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">Clients</p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="w-full h-9 mb-2 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />
        <div className="max-h-48 overflow-y-auto space-y-1">
          {clients === null && <p className="font-body text-sm text-steel px-1 py-2">Loading…</p>}
          {clients !== null && filteredClients.length === 0 && (
            <p className="font-body text-sm text-steel px-1 py-2">{query.trim() ? "No match." : "No one-on-one clients yet."}</p>
          )}
          {filteredClients.map((c) => {
            const status = clientActivityStatus(c.lastWorkoutAt);
            const tier = computeQuietTier({ lastLoggedAt: c.lastWorkoutAt ? new Date(c.lastWorkoutAt) : null, now: new Date(), trainingDays: c.trainingDays });
            return (
              <div key={c.id} className="border border-steel/15 px-2 py-2">
                <div className="flex items-center gap-2.5">
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-graphite border border-steel/30 flex items-center justify-center shrink-0">
                      <span className="font-display text-xs text-chalk">{initialsOf(c.fullName)}</span>
                    </div>
                  )}
                  <span className="font-body text-sm text-chalk truncate flex-1 text-left min-w-0">{c.fullName}</span>
                  <span className="font-body text-xs text-steel shrink-0 flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dotClass}`} />
                    {tier !== "none" ? QUIET_TIER_LABEL[tier] : status.text}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {/* Primary: the explicit in-person log route ("Logging for X",
                      marked coach-logged, no credit spent unless chosen). */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => logSessionFor(c)}
                    className="flex-1 h-9 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-50 active:bg-rust/80"
                  >
                    Log session
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => requestActAsClient(c)}
                    className="h-9 px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-50 active:border-rust/50"
                  >
                    View as client
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">Groups</p>
        <div className="max-h-40 overflow-y-auto space-y-2">
          {groups === null && <p className="font-body text-sm text-steel px-1 py-2">Loading…</p>}
          {groupSections.map(
            (section) =>
              section.list.length > 0 && (
                <div key={section.kind}>
                  {section.kind !== "team" && <p className="font-body text-xs text-steel uppercase tracking-wide px-1">{section.label}</p>}
                  {section.list.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      disabled={busy}
                      onClick={() => switchToGroup(g.id)}
                      className={`w-full text-left px-2 py-2 font-body text-sm disabled:opacity-50 ${g.id === groupId ? "text-rust bg-rust/10" : "text-chalk active:bg-surface/60"}`}
                    >
                      {g.name}
                      {g.focusTag && <span className="text-steel"> · {g.focusTag}</span>}
                    </button>
                  ))}
                </div>
              )
          )}
        </div>
      </div>

      <div className="border-t border-steel/20 pt-3">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">+ Create Group</p>
        <div className="flex items-center gap-1 mb-1.5">
          {GROUP_KIND_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setNewGroupKind(k)}
              className={`h-6 px-2 font-body text-xs border ${newGroupKind === k ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"}`}
            >
              {GROUP_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateGroup();
            }}
            placeholder="New group name"
            disabled={creating}
            className="flex-1 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleCreateGroup}
            disabled={creating || !newGroupName.trim()}
            aria-label="Create group"
            className="h-9 px-3 bg-rust text-graphite flex items-center justify-center disabled:opacity-40"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
