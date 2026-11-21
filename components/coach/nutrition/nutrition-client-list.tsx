import Link from "next/link";
import { shortDateLabel } from "@/lib/apply-from";
import { weekFacts, type LoadedWeek } from "@/lib/coach-nutrition-week";

export interface ListAthlete {
  profileId: string;
  fullName: string;
  groupId: string;
}

// The Clients list of Nutrition (Ron, Nov 19 revamp): every client with three plain facts about the last seven days (days logged, days their protein target was reached, their last
// log). Clients with no logs this week come first. A client the facts could not be read for is still listed, by name.
// self: the coach's OWN row, first (Ron, Nov 21: to set their own meal plan). It opens their personal space's nutrition; only the signed-in coach ever sees it, and it is not a client.
export function NutritionClientList({ athletes, week, selectedId, self }: { athletes: ListAthlete[]; week: LoadedWeek; selectedId: string | null; self?: { name: string; href: string } }) {
  const selfRow = self ? <Row key="self" href={self.href} name={`${self.name} (you)`} facts={[]} selected={!!selectedId && selectedId === selfIdOf(self.href)} self /> : null;
  if (athletes.length === 0)
    return selfRow ? (
      <div>
        <ul className="divide-y divide-steel/15" data-nutrition-client-list>
          {selfRow}
        </ul>
        <p className="font-body text-sm text-steel p-3">No clients yet.</p>
      </div>
    ) : (
      <p className="font-body text-sm text-steel p-3">No clients yet.</p>
    );
  const byKey = new Map(athletes.map((a) => [`${a.profileId}|${a.groupId}`, a]));
  const listed = week.rows.filter((r) => byKey.has(`${r.id}|${r.groupId}`));
  const shown = new Set(listed.map((r) => `${r.id}|${r.groupId}`));
  const rest = athletes.filter((a) => !shown.has(`${a.profileId}|${a.groupId}`));
  return (
    <div>
      {week.failed && (
        <p className="font-body text-xs text-rust-ink px-3 py-2 border-b border-steel/15" role="alert">
          Couldn&apos;t load this week&apos;s numbers. Reload to try again.
        </p>
      )}
      <ul className="divide-y divide-steel/15" data-nutrition-client-list>
        {selfRow}
        {listed.map((r) => (
          <Row key={`${r.id}|${r.groupId}`} href={`/groups/${r.groupId}/nutrition?athleteId=${r.id}`} name={r.fullName} facts={weekFacts(r, shortDateLabel)} selected={selectedId === r.id} />
        ))}
        {rest.map((a) => (
          <Row key={`${a.profileId}|${a.groupId}`} href={`/groups/${a.groupId}/nutrition?athleteId=${a.profileId}`} name={a.fullName} facts={[]} selected={selectedId === a.profileId} />
        ))}
      </ul>
    </div>
  );
}

// The athleteId in the self row's link (it is the coach's own id).
function selfIdOf(href: string): string | null {
  return new URL(href, "https://x.invalid").searchParams.get("athleteId");
}

function Row({ href, name, facts, selected, self = false }: { href: string; name: string; facts: string[]; selected: boolean; self?: boolean }) {
  return (
    <li {...(self ? { "data-nutrition-self": "" } : {})}>
      <Link href={href} aria-current={selected ? "page" : undefined} className={`block min-h-11 px-3 py-2 ${selected ? "bg-rust/10" : "hover:bg-surface/40"}`}>
        <span className={`block font-body text-sm ${selected ? "text-rust-ink" : "text-chalk"}`}>{name}</span>
        {facts.length > 0 && (
          <span className="block font-body text-xs text-steel [font-variant-numeric:tabular-nums]" data-week-facts>
            {facts.join(" · ")}
          </span>
        )}
      </Link>
    </li>
  );
}
