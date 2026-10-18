import Link from "next/link";
import { PendingInviteActions } from "@/components/org/pending-invite-actions";
import { InviteCoachForm } from "@/components/coach/desktop/invite-coach-form";
import type { GroupCoachRow } from "@/lib/pending-coaches";
import type { PendingInvitee } from "@/lib/coach-invite-server";

const ROLE_WORD: Record<string, string> = { owner: "Owner", admin: "Admin", coach: "Coach", front_desk: "Front desk" };

// The ONE list of coaches, at the top of the Clients / Athletes page: every coach of this group with their role; the viewer is marked "You"; anyone who has not accepted their invitation says "Invited, not accepted
// yet" and (for an organization owner or admin) has Send again / Copy link / Cancel right in the row. An owner or admin also sees the "Invite a coach" button here. Other coaches see names and roles only.
export function CoachesSection({
  groupId,
  viewerId,
  coaches,
  pending,
  canManage,
}: {
  groupId: string;
  viewerId: string;
  coaches: GroupCoachRow[];
  pending: PendingInvitee[];
  canManage: boolean;
}) {
  const pendingById = new Map(pending.map((p) => [p.profileId, p]));
  const sorted = [...coaches].sort((a, b) => {
    const rank = (c: GroupCoachRow) => (c.profileId === viewerId ? 0 : pendingById.has(c.profileId) ? 2 : 1);
    return rank(a) - rank(b) || a.fullName.localeCompare(b.fullName);
  });
  return (
    <section aria-label="Coaches" className="mb-8 border border-steel/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="font-display uppercase text-lg tracking-wide">Coaches</h2>
        {canManage && <InviteCoachForm groupId={groupId} />}
      </div>
      {sorted.length === 0 ? (
        <p className="font-body text-sm text-steel">No coaches yet.</p>
      ) : (
        <ul className="divide-y divide-steel/15">
          {sorted.map((c) => {
            const p = pendingById.get(c.profileId);
            return (
              <li key={c.profileId} className="flex flex-wrap items-center gap-3 py-2">
                {c.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-surface border border-steel/30 flex items-center justify-center">
                    <span className="font-display text-xs text-chalk">
                      {c.fullName
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="font-body text-sm">
                  {c.fullName}
                  {c.profileId === viewerId && <span className="text-steel text-xs ml-2">You</span>}
                </span>
                <span className="font-body text-xs text-rust">{ROLE_WORD[c.orgRole] ?? "Coach"}</span>
                {p && <span className="font-body text-xs text-steel">Invited, not accepted yet</span>}
                {p && canManage && (
                  <div className="ml-auto flex flex-wrap items-center gap-x-4">
                    <PendingInviteActions groupId={groupId} profileId={p.profileId} name={p.name} email={p.email} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canManage && (
        <p className="font-body text-xs text-steel mt-3">
          <Link href={`/groups/${groupId}/branding?tab=team`} className="underline underline-offset-2">
            Manage invitations on the Team page
          </Link>
        </p>
      )}
    </section>
  );
}
