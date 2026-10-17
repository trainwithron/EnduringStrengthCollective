"use client";

import { useRouter } from "next/navigation";

// "One group at a time, with a dropdown at the top to switch": the coach's feed in their own client app. Choosing a group reloads the feed for it; the address stays the coach's own space, so the bar, the Spot button
// and the tabs do not change. The organization's name is shown when the coach has groups in more than one.
export function FeedGroupPicker({ spaceId, choices, selectedId }: { spaceId: string; choices: { id: string; name: string; orgName: string }[]; selectedId: string }) {
  const router = useRouter();
  const severalOrgs = new Set(choices.map((c) => c.orgName)).size > 1;
  if (choices.length < 2) {
    return (
      <p className="px-5 pt-4 font-body text-sm text-steel">
        {choices[0]?.name}
        {severalOrgs ? ` · ${choices[0]?.orgName}` : ""}
      </p>
    );
  }
  return (
    <div className="px-5 pt-4">
      <label htmlFor="feed-group" className="font-body text-xs text-steel uppercase tracking-wide">
        Group
      </label>
      <select
        id="feed-group"
        value={selectedId}
        onChange={(e) => router.push(`/groups/${spaceId}/feed?group=${e.target.value}`)}
        className="w-full h-11 mt-1 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-base"
      >
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {severalOrgs ? ` · ${c.orgName}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
