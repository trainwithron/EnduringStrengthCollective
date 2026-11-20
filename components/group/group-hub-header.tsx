import { AddClientButton } from "@/components/coach/desktop/add-client-button";
import { NotificationBell, type NotificationEntry } from "@/components/athlete/notification-bell";

interface GroupHubHeaderProps {
  name: string;
  description: string | null;
  memberCount: number;
  // One-on-one groups are a single person; "1 member" is noise there.
  hideMemberCount?: boolean;
  isCoach: boolean;
  groupId: string;
  coachId?: string;
  viewerId?: string;
  notifications?: NotificationEntry[];
  logoUrl?: string | null;
  // The coach's own space: on a phone their notices live in the Spotlight button (its dot and the top of its drop-down), so this bell shows only at a computer.
  bellOnComputerOnly?: boolean;
  // A client's Home (Look Refresh, client step, Ron Nov 20): "Hey {first name}" with a small "{date} · with Coach {name}" line, instead of the big group title.
  greeting?: { title: string; line: string } | null;
}

export function GroupHubHeader({
  name,
  description,
  memberCount,
  hideMemberCount,
  isCoach,
  groupId,
  coachId,
  viewerId,
  notifications,
  logoUrl,
  bellOnComputerOnly = false,
  greeting = null,
}: GroupHubHeaderProps) {
  if (greeting) {
    return (
      <header className="px-5 pt-5 pb-1" data-client-greeting>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, not a local asset Next can optimize.
              <img src={logoUrl} alt="" className="h-8 max-w-[140px] object-contain mb-3" />
            )}
            <p className="font-body text-[13px] text-steel">{greeting.line}</p>
            <h1 className="font-display font-semibold text-[30px] leading-tight text-chalk break-words">{greeting.title}</h1>
          </div>
          {notifications && viewerId && (bellOnComputerOnly ? (
            <span className="hidden lg:inline-flex" data-bell-computer-only>
              <NotificationBell initial={notifications} viewerId={viewerId} />
            </span>
          ) : (
            <NotificationBell initial={notifications} viewerId={viewerId} />
          ))}
        </div>
        {description ? <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">{description}</p> : null}
      </header>
    );
  }
  return (
    <header className="px-5 pt-8 pb-6 border-b border-steel/20">
      <div className="flex items-start justify-between gap-3">
        {hideMemberCount ? (
          <span />
        ) : (
          <p className="font-body text-xs tracking-wide text-steel">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </p>
        )}
        {notifications && viewerId && (bellOnComputerOnly ? (
          <span className="hidden lg:inline-flex" data-bell-computer-only>
            <NotificationBell initial={notifications} viewerId={viewerId} />
          </span>
        ) : (
          <NotificationBell initial={notifications} viewerId={viewerId} />
        ))}
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
          <AddClientButton groupId={groupId} groupName={name} createdBy={coachId} />
        </div>
      )}
    </header>
  );
}
