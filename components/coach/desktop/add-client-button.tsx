"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";

function randomCode(length = 10) {
  // Excludes visually ambiguous characters (0/O, 1/l/I) since this gets
  // read aloud or retyped as often as it gets clicked.
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

type Mode = "link" | "direct";
type Destination = "current" | "existing" | "new";

interface OrgGroupOption {
  id: string;
  name: string;
}

// One "Add client" entry point covering both ways to bring a client in —
// a shareable invite link (they sign themselves up whenever they get to
// it) or adding them directly by name/email (a real account exists
// immediately, so a coach can start building their program before they've
// ever logged in). Previously two separate buttons; merged since they're
// really one decision ("how do you want to add this client?"), not two
// different features.
//
// A destination picker sits above both modes: the current group (default,
// today's behavior), any other group in the org (for a 1-on-1 client who
// should share a sub-group's feed/community with other clients), or a
// brand-new group created on the spot and flagged group_kind: "one_on_one" — the
// "don't make me create a group first" path. All three ultimately resolve
// to a single groupId used by whichever mode's existing logic runs next.
export function AddClientButton({
  groupId,
  groupName,
  createdBy,
}: {
  groupId: string;
  groupName: string;
  createdBy: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("link");

  // Destination-picker state
  const [destination, setDestination] = useState<Destination>("current");
  const [orgGroups, setOrgGroups] = useState<OrgGroupOption[] | null>(null);
  const [loadingOrgGroups, setLoadingOrgGroups] = useState(false);
  const [selectedExistingGroupId, setSelectedExistingGroupId] = useState<string>("");
  const [newGroupName, setNewGroupName] = useState("");
  const [destinationError, setDestinationError] = useState<string | null>(null);

  // Invite-link mode state
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Add-directly mode state
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [directSuccess, setDirectSuccess] = useState(false);

  // Caches the group created for the "new 1-on-1 group" destination so a
  // failed first attempt (e.g. the invite email hitting a rate limit) and a
  // retry via the other mode reuse the same group instead of each silently
  // creating its own — which previously left an orphaned, member-less group
  // behind on every retry.
  const createdGroupIdRef = useRef<string | null>(null);

  // Lazily fetches every group this coach coaches (plus every group in
  // the org, if owner/admin) — same fetch shape GroupSwitcher already
  // uses, since that's exactly what "groups I could add a client to"
  // means under RLS.
  async function loadOrgGroups() {
    if (orgGroups || loadingOrgGroups) return;
    setLoadingOrgGroups(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadingOrgGroups(false);
      return;
    }

    const [{ data: membership }, { data: coachedRows }] = await Promise.all([
      supabase.from("organization_memberships").select("organization_id, role").eq("profile_id", user.id).maybeSingle(),
      supabase.from("group_memberships").select("groups ( id, name )").eq("profile_id", user.id).eq("role", "coach"),
    ]);

    const byId = new Map<string, OrgGroupOption>();
    for (const row of coachedRows ?? []) {
      const g = (row as any).groups;
      if (g) byId.set(g.id, { id: g.id, name: g.name });
    }
    if (membership && (membership.role === "owner" || membership.role === "admin")) {
      const { data: allGroups } = await supabase
        .from("groups")
        .select("id, name")
        .eq("organization_id", membership.organization_id)
        .order("name");
      for (const g of allGroups ?? []) byId.set(g.id, { id: g.id, name: g.name });
    }

    const sorted = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    setOrgGroups(sorted);
    setSelectedExistingGroupId((prev) => prev || sorted.find((g) => g.id !== groupId)?.id || "");
    setLoadingOrgGroups(false);
  }

  // Resolves the destination picker down to one groupId, creating a new
  // group on the spot when needed. Returns null (with destinationError
  // set) if the picker isn't in a submittable state.
  async function resolveGroupId(fallbackName: string): Promise<string | null> {
    setDestinationError(null);
    if (destination === "current") return groupId;

    if (destination === "existing") {
      if (!selectedExistingGroupId) {
        setDestinationError("Pick a group.");
        return null;
      }
      return selectedExistingGroupId;
    }

    // destination === "new"
    if (createdGroupIdRef.current) return createdGroupIdRef.current;

    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setDestinationError("Couldn't create the group — try again.");
      return null;
    }
    const { data: membership } = await supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!membership) {
      setDestinationError("Couldn't find your organization — try again.");
      return null;
    }

    const trimmedName = newGroupName.trim() || fallbackName.trim() || "New 1-on-1 client";
    const newGroupId = crypto.randomUUID();
    const { error: groupError } = await supabase.from("groups").insert({
      id: newGroupId,
      name: trimmedName,
      created_by: user.id,
      organization_id: membership.organization_id,
      group_kind: "one_on_one",
    });
    if (groupError) {
      setDestinationError("Couldn't create the group — try again.");
      return null;
    }
    await supabase.from("group_memberships").insert({ group_id: newGroupId, profile_id: user.id, role: "coach" });
    createdGroupIdRef.current = newGroupId;
    return newGroupId;
  }

  async function handleGenerateLink() {
    setGenerating(true);
    setLinkError(null);

    const targetGroupId = await resolveGroupId("New 1-on-1 client");
    if (!targetGroupId) {
      setGenerating(false);
      return;
    }

    const supabase = createBrowserClient();
    const code = randomCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase.from("group_invites").insert({
      group_id: targetGroupId,
      code,
      role: "athlete",
      created_by: createdBy,
      expires_at: expiresAt,
    });

    if (insertError) {
      setLinkError("Couldn't create an invite link.");
      setGenerating(false);
      return;
    }

    setLink(`${window.location.origin}/invite/${code}`);
    if (targetGroupId !== groupId) router.refresh();
    setGenerating(false);
  }

  async function handleCopy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDirectSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setDirectError(null);

    try {
      const targetGroupId = await resolveGroupId(fullName);
      if (!targetGroupId) {
        setSubmitting(false);
        return;
      }

      const res = await fetch("/api/clients/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: targetGroupId, fullName, email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't add this client.");

      setDirectSuccess(true);
      setFullName("");
      setEmail("");
      // A different destination than the group currently being viewed
      // won't show the new client here even after a refresh — send the
      // coach straight to where the client actually landed.
      if (targetGroupId !== groupId) {
        router.push(`/groups/${targetGroupId}/clients`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setDirectError(err instanceof Error ? err.message : "Couldn't add this client.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    setOpen(false);
    setLink(null);
    setDirectSuccess(false);
    setMode("link");
    setDestination("current");
    setSelectedExistingGroupId("");
    setNewGroupName("");
    setDestinationError(null);
    createdGroupIdRef.current = null;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 h-11 px-4 border border-rust text-rust font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors"
      >
        <UserPlus className="w-4 h-4" strokeWidth={2.5} />
        Add client
      </button>
    );
  }

  return (
    <div className="border border-steel/30 p-4 max-w-sm bg-surface">
      <div className="mb-3">
        <label htmlFor="client-destination" className="font-body text-xs text-steel">
          Add to
        </label>
        <select
          id="client-destination"
          value={destination}
          onChange={(e) => {
            const next = e.target.value as Destination;
            setDestination(next);
            setDestinationError(null);
            if (next === "existing") loadOrgGroups();
          }}
          className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
        >
          <option value="current">{groupName}</option>
          <option value="existing">Another group…</option>
          <option value="new">Create a new 1-on-1 group…</option>
        </select>
        {destination === "existing" && (
          <select
            value={selectedExistingGroupId}
            onChange={(e) => setSelectedExistingGroupId(e.target.value)}
            disabled={loadingOrgGroups}
            className="w-full h-9 mt-1.5 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-60"
          >
            {loadingOrgGroups && <option>Loading…</option>}
            {(orgGroups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        {destination === "new" && (
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder={fullName || "Group name"}
            className="w-full h-9 mt-1.5 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
          />
        )}
        {destinationError && <p className="font-body text-xs text-rust mt-1">{destinationError}</p>}
      </div>

      <div className="flex items-center gap-1 mb-3">
        {(["link", "direct"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`h-8 px-3 font-body text-xs border ${
              mode === m ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
            }`}
          >
            {m === "link" ? "Invite link" : "Add directly"}
          </button>
        ))}
      </div>

      {mode === "link" ? (
        link ? (
          <div>
            <p className="font-body text-xs text-steel mb-2">Invite link &middot; expires in 7 days</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.target.select()}
                className="flex-1 h-10 min-w-0 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="h-10 px-3 border border-rust text-rust font-body text-xs shrink-0"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button type="button" onClick={handleClose} className="font-body text-xs text-steel mt-3">
              Done
            </button>
          </div>
        ) : (
          <div>
            <p className="font-body text-xs text-steel mb-3">
              They sign up themselves whenever they get to it.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleGenerateLink}
                disabled={generating}
                className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
              >
                {generating ? "Generating…" : "Generate link"}
              </button>
              <button type="button" onClick={handleClose} className="font-body text-xs text-steel">
                Cancel
              </button>
            </div>
            {linkError && <p className="font-body text-xs text-rust mt-2">{linkError}</p>}
          </div>
        )
      ) : directSuccess ? (
        <div>
          <p className="font-body text-sm text-positive">
            Client added — they&apos;ll get an email to set their password. You can already assign
            a program to them.
          </p>
          <button type="button" onClick={handleClose} className="font-body text-xs text-rust mt-3">
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleDirectSubmit} className="space-y-3">
          <p className="font-body text-xs text-steel">
            A real account exists immediately — build/assign a program before they&apos;ve ever
            logged in.
          </p>
          <div>
            <label htmlFor="client-name" className="font-body text-xs text-steel">
              Full name
            </label>
            <input
              id="client-name"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            />
          </div>
          <div>
            <label htmlFor="client-email" className="font-body text-xs text-steel">
              Email
            </label>
            <input
              id="client-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-10 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm focus:outline-none focus:border-rust"
            />
          </div>
          {directError && (
            <p className="font-body text-xs text-rust" role="alert">
              {directError}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
            >
              {submitting ? "Adding…" : "Add client"}
            </button>
            <button type="button" onClick={handleClose} disabled={submitting} className="font-body text-xs text-steel disabled:opacity-40">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
