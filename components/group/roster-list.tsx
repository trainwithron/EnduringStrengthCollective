import type { RosterMember } from "@/lib/types";
import { RosterRow } from "./roster-row";

export function RosterList({
  members,
  groupId,
  viewerId,
  viewerIsCoach,
}: {
  members: RosterMember[];
  groupId: string;
  viewerId?: string;
  viewerIsCoach: boolean;
}) {
  const coaches = members.filter((m) => m.role === "coach");
  const athletes = members.filter((m) => m.role === "athlete");
  const isOnlyCoach = coaches.length === 1;

  return (
    <section className="px-5">
      {coaches.length > 0 && (
        <div className="pt-6">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Coaching staff
          </h2>
          <div className="divide-y divide-steel/15">
            {coaches.map((m) => (
              <RosterRow
                key={m.profileId}
                member={m}
                groupId={groupId}
                viewerIsCoach={viewerIsCoach}
                isViewer={m.profileId === viewerId}
                isOnlyCoach={isOnlyCoach}
              />
            ))}
          </div>
        </div>
      )}

      <div className="pt-6">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
          Roster
        </h2>
        {athletes.length === 0 ? (
          <p className="font-body text-sm text-steel py-6">
            No athletes yet. Send an invite to get the first one training.
          </p>
        ) : (
          <div className="divide-y divide-steel/15">
            {athletes.map((m) => (
              <RosterRow
                key={m.profileId}
                member={m}
                groupId={groupId}
                viewerIsCoach={viewerIsCoach}
                isViewer={m.profileId === viewerId}
                isOnlyCoach={isOnlyCoach}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
