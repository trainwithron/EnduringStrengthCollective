import Link from "next/link";

export interface HomeGroupCardData {
  id: string;
  name: string;
  focusTag: string | null;
  memberCount: number;
}

// Team/social groups keep their own identity front and center (unlike
// 1-on-1 clients) — the group itself, not one member, is the thing being
// navigated to. Lands on the same /dashboard destination the sidebar's
// own "Dashboard" nav item already uses once inside a group.
export function HomeGroupCard({ group }: { group: HomeGroupCardData }) {
  return (
    <Link
      href={`/groups/${group.id}/dashboard`}
      className="flex flex-col gap-1 border border-steel/30 bg-surface p-3 hover:border-rust/50 transition-colors"
    >
      <p className="font-body text-sm text-chalk truncate">{group.name}</p>
      <p className="font-body text-xs text-steel">
        {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
        {group.focusTag && ` · ${group.focusTag}`}
      </p>
    </Link>
  );
}
