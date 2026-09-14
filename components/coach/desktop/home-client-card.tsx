import Link from "next/link";
import { clientActivityStatus } from "@/lib/client-activity-status";
import { initialsOf } from "@/lib/initials";

export interface HomeClientCardData {
  groupId: string;
  athleteId: string;
  fullName: string;
  avatarUrl: string | null;
  lastWorkoutAt: string | null;
  hasUnseenActivity: boolean;
  // Frequency-normalized quiet-client tier (lib/quiet-client-tier.ts) —
  // a different, program-aware signal from the plain "days since last
  // log" status dot above; both render at once since they answer
  // different questions ("how recently" vs. "relative to their own
  // schedule").
  quietTier?: "mild" | "strong";
}

// A 1-on-1 client's "group" is invisible bookkeeping — this card shows
// the client's own identity and links straight into their profile page
// (stats, PRs, current program, notes, body weight), which is more
// useful than a solo-group activity dashboard for a card that's really
// about one specific person. Team/social group cards still land on
// their group dashboard (components/coach/desktop/home-group-card.tsx) —
// only this per-client destination changed.
export function HomeClientCard({ client }: { client: HomeClientCardData }) {
  const status = clientActivityStatus(client.lastWorkoutAt);
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
        {client.quietTier && (
          <p className="font-body text-[10px] text-rust uppercase tracking-wide mt-0.5">
            {client.quietTier === "strong" ? "Reach out — quiet a while" : "Missing scheduled sessions"}
          </p>
        )}
      </div>
    </Link>
  );
}
