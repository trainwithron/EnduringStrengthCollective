import Link from "next/link";

// Status-dot logic ported (not shared) from client-card-grid.tsx, same
// convention already used elsewhere in this app for small per-card
// display helpers.
function daysSinceOf(lastWorkoutAt: string | null): number {
  if (!lastWorkoutAt) return Infinity;
  return Math.floor((Date.now() - new Date(lastWorkoutAt).getTime()) / (1000 * 60 * 60 * 24));
}

function statusLabel(lastWorkoutAt: string | null): { text: string; dotClass: string } {
  if (!lastWorkoutAt) {
    return { text: "No logs yet", dotClass: "bg-steel" };
  }
  const daysSince = daysSinceOf(lastWorkoutAt);
  if (daysSince === 0) return { text: "Logged today", dotClass: "bg-moss" };
  if (daysSince === 1) return { text: "Logged yesterday", dotClass: "bg-steel" };
  if (daysSince <= 3) return { text: `${daysSince} days quiet`, dotClass: "bg-steel" };
  return { text: `${daysSince} days quiet`, dotClass: "bg-rust" };
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export interface HomeClientCardData {
  groupId: string;
  athleteId: string;
  fullName: string;
  avatarUrl: string | null;
  lastWorkoutAt: string | null;
  hasUnseenActivity: boolean;
}

// A 1-on-1 client's "group" is invisible bookkeeping — this card shows
// the client's own identity and links straight into their profile page
// (stats, PRs, current program, notes, body weight), which is more
// useful than a solo-group activity dashboard for a card that's really
// about one specific person. Team/social group cards still land on
// their group dashboard (components/coach/desktop/home-group-card.tsx) —
// only this per-client destination changed.
export function HomeClientCard({ client }: { client: HomeClientCardData }) {
  const status = statusLabel(client.lastWorkoutAt);
  return (
    <Link
      href={`/groups/${client.groupId}/athletes/${client.athleteId}`}
      className="relative flex items-center gap-3 border border-steel/30 bg-surface p-3 hover:border-rust/50 transition-colors"
    >
      {client.hasUnseenActivity && (
        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-rust" />
      )}
      {client.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={client.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-full bg-graphite border border-steel/30 flex items-center justify-center shrink-0">
          <span className="font-display font-bold text-xs text-steel">{initialsOf(client.fullName)}</span>
        </div>
      )}
      <div className="min-w-0">
        <p className="font-body text-sm text-chalk truncate">{client.fullName}</p>
        <p className="font-body text-xs text-steel flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`} />
          {status.text}
        </p>
      </div>
    </Link>
  );
}
