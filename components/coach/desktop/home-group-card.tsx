import Link from "next/link";
import { membersHref } from "@/lib/coach-clients-nav";

export interface HomeGroupCardData {
  id: string;
  name: string;
  focusTag: string | null;
  memberCount: number;
  hasUnseenActivity: boolean;
  // Set only when the viewing coach administers more than one
  // organization — see the matching field on HomeClientCardData.
  orgName?: string | null;
}

// Team/social groups keep their own identity front and center (unlike
// 1-on-1 clients) — the group itself, not one member, is the thing being
// navigated to. Opens the group's own roster (clutter audit DK11, Nov 21: there is no group dashboard in the navigation).
export function HomeGroupCard({ group }: { group: HomeGroupCardData }) {
  return (
    <Link prefetch={false}
      href={membersHref(group.id)}
      className="relative flex flex-col gap-1 border border-steel/30 bg-surface p-3 hover:border-rust/50 transition-colors"
    >
      {group.hasUnseenActivity && (
        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rust" />
      )}
      <p className="font-body text-sm text-chalk truncate">{group.name}</p>
      {group.orgName && (
        <p className="font-body text-[13px] text-steel truncate">
          {group.orgName}
        </p>
      )}
      <p className="font-body text-xs text-steel">
        {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
        {group.focusTag && ` · ${group.focusTag}`}
      </p>
    </Link>
  );
}
