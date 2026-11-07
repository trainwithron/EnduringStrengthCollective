import Link from "next/link";
import { MessageCircle } from "lucide-react";
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
  // A client's way to their coach, on every Home view (Ron, Nov 7: the only link was a small line of text partway down Today).
  messagesHref?: string;
  unreadMessages?: number;
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
  messagesHref,
  unreadMessages = 0,
}: GroupHubHeaderProps) {
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
        <div className="flex items-center gap-2">
          {messagesHref && (
            <Link
              href={messagesHref}
              aria-label={`Messages${unreadMessages > 0 ? ` (${unreadMessages} unread)` : ""}`}
              className="relative inline-flex items-center gap-1.5 h-11 px-3 border border-steel/40 text-chalk font-body text-sm"
            >
              <MessageCircle className="w-5 h-5" aria-hidden="true" />
              Messages
              {unreadMessages > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-rust text-graphite font-body text-xs font-semibold flex items-center justify-center">
                  {unreadMessages > 9 ? "9+" : unreadMessages}
                </span>
              )}
            </Link>
          )}
          {notifications && viewerId && (bellOnComputerOnly ? (
            <span className="hidden lg:inline-flex" data-bell-computer-only>
              <NotificationBell initial={notifications} viewerId={viewerId} />
            </span>
          ) : (
            <NotificationBell initial={notifications} viewerId={viewerId} />
          ))}
        </div>
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
