import Link from "next/link";
import { MessagesSquare, NotebookPen, Dumbbell, CalendarClock } from "lucide-react";
import { InviteAthleteButton } from "./invite-athlete-button";
import { SignOutButton } from "./sign-out-button";

interface GroupHubHeaderProps {
  name: string;
  description: string | null;
  memberCount: number;
  isCoach: boolean;
  groupId: string;
  coachId?: string;
}

export function GroupHubHeader({
  name,
  description,
  memberCount,
  isCoach,
  groupId,
  coachId,
}: GroupHubHeaderProps) {
  return (
    <header className="px-5 pt-8 pb-6 border-b border-steel/20">
      <div className="flex items-center justify-between">
        <p className="font-body text-xs tracking-wide text-steel">
          {memberCount} {memberCount === 1 ? "member" : "members"}
        </p>
        {isCoach && <SignOutButton />}
      </div>
      <h1 className="font-display font-bold text-4xl leading-none mt-1 uppercase">
        {name}
      </h1>
      {description ? (
        <p className="font-body text-sm text-steel mt-3 max-w-[60ch]">
          {description}
        </p>
      ) : null}

      {isCoach && (
        <Link
          href={`/groups/${groupId}/feed`}
          className="inline-flex items-center gap-2 h-11 px-4 mt-5 bg-rust text-graphite font-body text-sm font-medium active:bg-rust/80 transition-colors"
        >
          <MessagesSquare className="w-4 h-4" strokeWidth={2.5} />
          Team Feed
        </Link>
      )}

      {isCoach && (
        <div className="flex flex-wrap gap-3 mt-5">
          <Link
            href={`/groups/${groupId}/programs`}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-none border border-rust text-rust font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors"
          >
            <NotebookPen className="w-4 h-4" strokeWidth={2.5} />
            Program Builder
          </Link>
          <Link
            href={`/groups/${groupId}/exercise-library`}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-none border border-rust text-rust font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors"
          >
            <Dumbbell className="w-4 h-4" strokeWidth={2.5} />
            Exercise Library
          </Link>
          <Link
            href={`/groups/${groupId}/availability`}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-none border border-rust text-rust font-body text-sm font-medium active:bg-rust active:text-graphite transition-colors"
          >
            <CalendarClock className="w-4 h-4" strokeWidth={2.5} />
            Availability
          </Link>
          {coachId && <InviteAthleteButton groupId={groupId} createdBy={coachId} />}
        </div>
      )}
    </header>
  );
}
