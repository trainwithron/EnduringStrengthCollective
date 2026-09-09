import { InviteAthleteButton } from "./invite-athlete-button";
import { NotificationBell, type NotificationEntry } from "@/components/athlete/notification-bell";

interface GroupHubHeaderProps {
  name: string;
  description: string | null;
  memberCount: number;
  isCoach: boolean;
  groupId: string;
  coachId?: string;
  viewerId?: string;
  notifications?: NotificationEntry[];
  logoUrl?: string | null;
}

export function GroupHubHeader({
  name,
  description,
  memberCount,
  isCoach,
  groupId,
  coachId,
  viewerId,
  notifications,
  logoUrl,
}: GroupHubHeaderProps) {
  return (
    <header className="px-5 pt-8 pb-6 border-b border-steel/20">
      <div className="flex items-start justify-between gap-3">
        <p className="font-body text-xs tracking-wide text-steel">
          {memberCount} {memberCount === 1 ? "member" : "members"}
        </p>
        {notifications && viewerId && <NotificationBell initial={notifications} viewerId={viewerId} />}
      </div>
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset Next can optimize.
        <img src={logoUrl} alt="" className="h-10 max-w-[160px] object-contain mt-3" />
      )}
      <h1 className="font-display font-bold text-4xl leading-none mt-1 uppercase">
        {name}
      </h1>
      {description ? (
        <p className="font-body text-sm text-steel mt-3 max-w-[60ch]">
          {description}
        </p>
      ) : null}

      {/* Program Builder, Exercise Library, Availability, and Team Feed
          (already its own bottom tab) all moved out of this lightweight
          hub — reachable from Coach Dashboard (Settings) when actually
          needed, not competing for space with logging your own training.
          Inviting a client is common enough day-to-day to keep here. */}
      {isCoach && coachId && (
        <div className="mt-5">
          <InviteAthleteButton groupId={groupId} createdBy={coachId} />
        </div>
      )}
    </header>
  );
}
