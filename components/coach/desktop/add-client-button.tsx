"use client";

import { useEffect, useRef, useState } from "react";
import { createGroupWithCoach } from "@/lib/create-group";
import { discardEmptyGroup } from "@/lib/discard-empty-group";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { useTerm } from "@/components/coach/terminology-provider";
import { appOriginBrowser } from "@/lib/app-url";
import { SINGLE_LINK_NOTE } from "@/lib/invite-link-plan";
import { EmailClaimLinkButton } from "@/components/coach/email-claim-link-button";
import { RosterImportPanel } from "@/components/coach/desktop/roster-import-panel";

type Step = "choose" | "one_on_one" | "group";
type GroupMode = "name" | "link" | "roster";

interface GroupOption {
  id: string;
  name: string;
}

const inputClass = "w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-base sm:text-sm focus:outline-none focus:border-rust";

// ONE way to bring someone in (Ron, Oct 6: "an Add client button, and inside it: add a one-on-one client, and add to a group"). A plain Add client is always a
// one-on-one client with their own space; only the explicit "Add to a group" puts someone in a group. In a group you can add a person by name, or use the group's
// ONE current invite link (a new link replaces the old one, 7 days).
export function AddClientButton({
  groupId,
  groupName,
  createdBy,
  defaultOpen = false,
  onAdded,
}: {
  // The group the coach is standing in (only a starting point for "Add to a group").
  groupId: string;
  groupName: string;
  createdBy: string;
  defaultOpen?: boolean;
  // Called once someone has been added (the left panel uses it to show them in its list at once).
  onAdded?: () => void;
}) {
  void createdBy;
  const t = useTerm();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [step, setStep] = useState<Step>("choose");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Someone who already has an account: they were sent an invitation to accept instead of being added.
  const [invitedExisting, setInvitedExisting] = useState<{ email: string; already: boolean } | null>(null);
  // The person was already this coach's client: what was sent to them again (and the link, when it is for the coach to copy or text).
  const [resentNote, setResentNote] = useState<{ message: string; link: string | null } | null>(null);
  const [added, setAdded] = useState<{ groupId: string; profileId: string; name: string; inGroup: string | null; hasEmail: boolean; note?: string | null } | null>(null);
  const [groups, setGroups] = useState<GroupOption[] | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("name");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // What this coach coaches (asked at signup): a team or gym coach is shown "Add to a group" first, everyone else "Add a one-on-one client" first.
  const [groupsFirst, setGroupsFirst] = useState(false);
  // An owner or admin adding a one-on-one client can choose which coach in the organization holds them (default: themselves).
  const [orgCoaches, setOrgCoaches] = useState<{ id: string; name: string }[]>([]);
  const [assignTo, setAssignTo] = useState("");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("coach_type").eq("id", user.id).maybeSingle();
      const type = (data as { coach_type?: string | null } | null)?.coach_type;
      if (!cancelled) setGroupsFirst(type === "team" || type === "gym");
      const { data: current } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
      if (!current?.organization_id) return;
      const { data: mine } = await supabase.from("organization_memberships").select("role").eq("organization_id", current.organization_id).eq("profile_id", user.id).maybeSingle();
      if (mine?.role !== "owner" && mine?.role !== "admin") return;
      const { data: members } = await supabase.from("organization_memberships").select("profile_id, profiles ( full_name )").eq("organization_id", current.organization_id).neq("profile_id", user.id);
      if (!cancelled) setOrgCoaches(((members ?? []) as any[]).map((m) => ({ id: m.profile_id as string, name: (m.profiles as { full_name?: string } | null)?.full_name ?? "Coach" })).sort((a, b) => a.name.localeCompare(b.name)));
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);
  // A group made for a new one-on-one client: kept so a retry after a failure reuses it instead of leaving an empty space behind each time.
  const createdGroupIdRef = useRef<string | null>(null);

  // Team and social groups this coach coaches (a one-on-one space is not a group you add people to).
  async function loadGroups() {
    if (groups) return;
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: current } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
    const { data: rows } = await supabase.from("group_memberships").select("groups ( id, name, group_kind, organization_id )").eq("profile_id", user.id).eq("role", "coach");
    const list = ((rows ?? []) as any[])
      .map((r) => r.groups)
      .filter((g) => g && g.group_kind !== "one_on_one" && (!current?.organization_id || g.organization_id === current.organization_id))
      .map((g) => ({ id: g.id as string, name: g.name as string }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setGroups(list);
    setSelectedGroupId((prev) => prev || list.find((g) => g.id === groupId)?.id || list[0]?.id || "");
  }

  // Closing the box after the client's space was made but before anyone was added to it: the empty space is removed, so abandoned tries do not pile up as empty groups. A space that has a client is never touched.
  // (Through the server, which checks it is new, yours and empty: a signed-in person cannot delete a group directly.)
  async function removeEmptySpace(groupIdToCheck: string) {
    await discardEmptyGroup(groupIdToCheck);
  }

  function reset() {
    if (createdGroupIdRef.current && !added && !invitedExisting) void removeEmptySpace(createdGroupIdRef.current);
    setOpen(false);
    setStep("choose");
    setFullName("");
    setEmail("");
    setError(null);
    setAdded(null);
    setInvitedExisting(null);
    setResentNote(null);
    setLink(null);
    setGroupMode("name");
    createdGroupIdRef.current = null;
  }

  async function createOneOnOneSpace(name: string): Promise<string | null> {
    if (createdGroupIdRef.current) return createdGroupIdRef.current;
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Couldn't set up their space. Try again.");
      return null;
    }
    const { data: current } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
    const { data: membership } = current?.organization_id
      ? await supabase.from("organization_memberships").select("organization_id").eq("organization_id", current.organization_id).eq("profile_id", user.id).maybeSingle()
      : { data: null };
    if (!membership) {
      setError("Couldn't find your business. Try again.");
      return null;
    }
    const made = await createGroupWithCoach(supabase, { userId: user.id, name: name.trim() || "New client", organizationId: membership.organization_id, kind: "one_on_one" });
    if (!made.id) {
      setError("Couldn't set up their space. Try again.");
      return null;
    }
    createdGroupIdRef.current = made.id;
    return made.id;
  }

  async function addByName(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const target = step === "one_on_one" ? await createOneOnOneSpace(fullName) : selectedGroupId;
      if (!target) {
        if (step === "group") setError("Pick a group.");
        return;
      }
      const res = await fetch("/api/clients/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: target, fullName, email }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Couldn't add this ${t("client")}.`);
      if (data.resent) {
        setResentNote({ message: typeof data.message === "string" ? data.message : "Sent again.", link: typeof data.link === "string" ? data.link : null });
        setFullName("");
        setEmail("");
        router.refresh();
        return;
      }
      if (data.invitedExisting) {
        setInvitedExisting({ email: email.trim(), already: data.already === true });
        setFullName("");
        setEmail("");
        router.refresh();
        onAdded?.();
        return;
      }
      // The person adding chose another coach to hold this client: add them to the client's space (and step out of it).
      let note: string | null = null;
      if (step === "one_on_one" && assignTo) {
        const coachName = orgCoaches.find((c) => c.id === assignTo)?.name ?? "that coach";
        const { error: assignError } = await createBrowserClient().rpc("assign_group_coach", { p_group: target, p_coach: assignTo });
        note = assignError ? `Added, but ${coachName} could not be given them: ${assignError.message}. You still coach them; you can hand them over from the Team page.` : `${coachName} is their coach now.`;
      }
      setAdded({ groupId: target, profileId: data.profileId, name: fullName, inGroup: step === "group" ? groups?.find((g) => g.id === target)?.name ?? null : null, hasEmail: email.trim().length > 0, note });
      setFullName("");
      setEmail("");
      router.refresh();
      onAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Couldn't add this ${t("client")}.`);
    } finally {
      setSubmitting(false);
    }
  }

  async function makeLink() {
    if (!selectedGroupId) {
      setError("Pick a group.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/invites/group", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", groupId: selectedGroupId }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't make the link. Try again.");
      setLink(`${appOriginBrowser()}/invite/${data.code}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't make the link. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-2 h-11 px-4 border border-rust text-rust font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors">
        <UserPlus className="w-4 h-4" strokeWidth={2.5} />
        Add {t("client")}
      </button>
    );
  }

  const nameForm = (
    <form onSubmit={addByName} className="space-y-3">
      <div>
        <label htmlFor="client-name" className="font-body text-xs text-steel">
          Full name
        </label>
        <input id="client-name" type="text" required value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
      </div>
      <div>
        <label htmlFor="client-email" className="font-body text-xs text-steel">
          Email (optional)
        </label>
        <input id="client-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </div>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {submitting ? "Adding…" : `Add ${t("client")}`}
        </button>
        <button type="button" onClick={reset} disabled={submitting} className="font-body text-xs text-steel disabled:opacity-40">
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="border border-steel/30 p-4 w-full max-w-sm bg-surface">
      {resentNote ? (
        <div>
          <p className="font-body text-sm text-positive">They are already your client, so we sent it again.</p>
          <p className="font-body text-xs text-steel mt-1.5">{resentNote.message}</p>
          {resentNote.link && (
            <div className="flex items-center gap-2 mt-2">
              <input readOnly value={resentNote.link} onFocus={(e) => e.target.select()} className="flex-1 h-11 min-w-0 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none" />
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(resentNote.link!).catch(() => setError("Couldn't copy. Select the link and copy it by hand."))}
                className="h-11 px-3 border border-rust text-rust font-body text-xs shrink-0"
              >
                Copy
              </button>
            </div>
          )}
          <button type="button" onClick={reset} className="mt-3 font-body text-xs text-steel">
            Done
          </button>
        </div>
      ) : invitedExisting ? (
        <div>
          <p className="font-body text-sm text-positive">{invitedExisting.already ? "They have already been invited." : "They already have an account, so we sent them an invitation."}</p>
          <p className="font-body text-xs text-steel mt-1.5">
            {invitedExisting.email} sees it in the app{" "}
            and by email, and joins your space only if they accept. Nothing else is shared with you until they do.
          </p>
          <button type="button" onClick={reset} className="mt-3 font-body text-xs text-steel">
            Done
          </button>
        </div>
      ) : added ? (
        <div>
          <p className="font-body text-sm text-positive">
            {added.name} added{added.inGroup ? ` to ${added.inGroup}` : ""}. Nothing was sent to them.
          </p>
          {added.note && <p className="font-body text-xs text-steel mt-1.5">{added.note}</p>}
          <p className="font-body text-xs text-steel mt-1.5">Build their program and schedule now. When you&apos;re ready, send their sign-in link from their profile.</p>
          {added.hasEmail && (
            <div className="mt-3">
              <EmailClaimLinkButton groupId={added.groupId} athleteId={added.profileId} />
            </div>
          )}
          <div className="flex items-center gap-4 mt-3">
            <button type="button" onClick={() => router.push(`/groups/${added.groupId}/athletes/${added.profileId}`)} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium">
              Open their profile
            </button>
            <button type="button" onClick={reset} className="font-body text-xs text-steel">
              Done
            </button>
          </div>
        </div>
      ) : step === "choose" ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setStep("one_on_one")}
            className={`w-full text-left border border-steel/40 hover:border-rust px-3 py-3 ${groupsFirst ? "order-last" : ""}`}
          >
            <span className="block font-body text-sm text-chalk">Add a one-on-one {t("client")}</span>
            <span className="block font-body text-xs text-steel mt-0.5">Their own private space with you.</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("group");
              loadGroups();
            }}
            className="w-full text-left border border-steel/40 hover:border-rust px-3 py-3"
          >
            <span className="block font-body text-sm text-chalk">Add to a group</span>
            <span className="block font-body text-xs text-steel mt-0.5">Pick one of your groups, then add someone or share its link.</span>
          </button>
          <button type="button" onClick={reset} className="order-last font-body text-xs text-steel pt-1 text-left">
            Cancel
          </button>
        </div>
      ) : step === "one_on_one" ? (
        <div>
          <p className="font-body text-xs text-steel mb-3">
            Add a one-on-one {t("client")}. A real account is made right away, with no email sent, so you can build their program before they ever sign in.
          </p>
          {orgCoaches.length > 0 && (
            <div className="mb-3">
              <label htmlFor="assign-coach" className="font-body text-xs text-steel">
                Who coaches them
              </label>
              <select id="assign-coach" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={inputClass}>
                <option value="">Me</option>
                {orgCoaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {nameForm}
        </div>
      ) : (
        <div>
          <label htmlFor="group-pick" className="font-body text-xs text-steel">
            Which group
          </label>
          <select id="group-pick" value={selectedGroupId} onChange={(e) => { setSelectedGroupId(e.target.value); setLink(null); }} disabled={!groups} className={inputClass}>
            {!groups && <option>Loading…</option>}
            {groups && groups.length === 0 && <option value="">You have no groups yet</option>}
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 my-3">
            {(["name", "roster", "link"] as GroupMode[]).map((m) => (
              <button key={m} type="button" onClick={() => setGroupMode(m)} className={`h-10 px-3 font-body text-xs border ${groupMode === m ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"}`}>
                {m === "name" ? "Add by name" : m === "roster" ? "Paste a list" : "Invite link"}
              </button>
            ))}
          </div>
          {groupMode === "name" ? (
            nameForm
          ) : groupMode === "roster" ? (
            selectedGroupId ? (
              <RosterImportPanel key={selectedGroupId} groupId={selectedGroupId} groupName={groups?.find((g) => g.id === selectedGroupId)?.name ?? groupName} onAdded={onAdded} onClose={reset} />
            ) : (
              <p className="font-body text-xs text-steel">Pick a group first.</p>
            )
          ) : link ? (
            <div>
              <p className="font-body text-xs text-steel mb-2">Works for 7 days.</p>
              <div className="flex items-center gap-2">
                <input readOnly value={link} onFocus={(e) => e.target.select()} className="flex-1 h-11 min-w-0 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none" />
                <button type="button" onClick={copy} className="h-11 px-3 border border-rust text-rust font-body text-xs shrink-0">
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <button type="button" onClick={reset} className="font-body text-xs text-steel mt-3">
                Done
              </button>
            </div>
          ) : (
            <div>
              <p className="font-body text-xs text-steel mb-3">{SINGLE_LINK_NOTE} They join {groups?.find((g) => g.id === selectedGroupId)?.name ?? groupName} when they sign up.</p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={makeLink} disabled={submitting || !selectedGroupId} className="h-11 px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
                  {submitting ? "Making…" : "Make the link"}
                </button>
                <button type="button" onClick={reset} className="font-body text-xs text-steel">
                  Cancel
                </button>
              </div>
              {error && (
                <p className="font-body text-xs text-rust mt-2" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
