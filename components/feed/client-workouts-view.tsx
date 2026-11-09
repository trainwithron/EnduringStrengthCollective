import Link from "next/link";
import { LoggedWorkoutCard } from "@/components/coach/logged-workout-card";
import { CLIENT_WORKOUTS_PAGE, type ClientWorkout } from "@/lib/client-workouts";

// The switch at the top of a coach's Feed tab.
export function FeedViewSwitch({ basePath, active }: { basePath: string; active: "clients" | "group" }) {
  const item = (view: "clients" | "group", label: string) => (
    <Link
      href={`${basePath}?view=${view}`}
      aria-current={active === view ? "page" : undefined}
      className={`flex-1 min-h-11 inline-flex items-center justify-center font-body text-sm border ${active === view ? "bg-rust text-graphite border-rust font-bold" : "border-steel/30 text-chalk"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex gap-2">
      {item("clients", "Client workouts")}
      {item("group", "Group feed")}
    </div>
  );
}

export function ClientWorkoutsList({
  workouts,
  hasMore,
  limit,
  basePath,
  timeZone,
}: {
  workouts: ClientWorkout[];
  hasMore: boolean;
  limit: number;
  basePath: string;
  timeZone?: string;
}) {
  if (workouts.length === 0) return <p className="font-body text-sm text-steel py-4">No client workouts yet. When a client finishes one, it shows up here.</p>;
  return (
    <div className="space-y-3">
      {workouts.map((w) => (
        <LoggedWorkoutCard
          key={w.id}
          clientName={w.clientName}
          clientHref={`/groups/${w.groupId}/athletes/${w.athleteId}`}
          title={w.title}
          dateLabel={new Date(w.createdAt).toLocaleDateString("en-US", { timeZone })}
          sessionId={w.sessionId}
          loggedByCoach={w.loggedByCoach}
          volume={w.volume}
          sets={w.sets}
          durationSeconds={w.durationSeconds}
          prs={w.prs}
          exerciseNames={w.exerciseNames}
        />
      ))}
      {hasMore && (
        <Link href={`${basePath}?view=clients&limit=${limit + CLIENT_WORKOUTS_PAGE}`} className="min-h-11 w-full inline-flex items-center justify-center border border-steel/30 font-body text-sm text-chalk">
          Show more
        </Link>
      )}
    </div>
  );
}
