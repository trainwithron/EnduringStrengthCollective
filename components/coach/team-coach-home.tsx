import Link from "next/link";
import { teamHomeTiles } from "@/lib/team-coach";

// The top of a team coach's Home: one tile for each thing a team coach reaches for. Shown above the usual Home.
export function TeamCoachHome({ groupId, teamName }: { groupId: string; teamName: string }) {
  const tiles = teamHomeTiles(groupId);
  return (
    <section className="mb-8" aria-labelledby="team-home-heading">
      <h2 id="team-home-heading" className="font-display font-bold text-2xl uppercase leading-none">
        {teamName}
      </h2>
      <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              target={t.newTab ? "_blank" : undefined}
              rel={t.newTab ? "noopener noreferrer" : undefined}
              className="block h-full min-h-[88px] border border-steel/25 p-3 hover:border-rust/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rust"
            >
              <span className="block font-body text-sm font-medium text-chalk">{t.label}</span>
              <span className="block font-body text-xs text-steel mt-1">{t.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
