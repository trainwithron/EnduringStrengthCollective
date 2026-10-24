import type { RosterMember } from "@/lib/types";
import { RosterRow } from "./roster-row";

export function RosterList({
  members,
  groupId,
  viewerId,
  viewerIsCoach,
  hiddenProfileIds = [],
}: {
  members: RosterMember[];
  groupId: string;
  viewerId?: string;
  viewerIsCoach: boolean;
  // Coaches who have not accepted their invitation yet: not shown as working coaches.
  hiddenProfileIds?: string[];
}) {
  const hidden = new Set(hiddenProfileIds);
  const coaches = members.filter((m) => m.role === "coach" && !hidden.has(m.profileId));
  // The client's side lists their coaches, never the viewer themself: in a coach's own personal space the only "coach" is them (Oct 24: "Coaching staff: Coach Ron · 42 days quiet"),
  // so the section is not shown there at all.
  const staffShown = coaches.filter((m) => m.profileId !== viewerId);
  const athletes = members.filter((m) => m.role === "athlete");
  const isOnlyCoach = coaches.length === 1;

  return (
    <section className="px-5">
      {!viewerIsCoach && staffShown.length > 0 && (
        <div className="pt-6">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Coaching staff
          </h2>
          <div className="divide-y divide-steel/15">
            {staffShown.map((m) => (
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

      {viewerIsCoach && (
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
      )}
    </section>
  );
}
