"use client";

import { useState } from "react";
import Link from "next/link";
import { teamHomeTiles, type TeamChoice } from "@/lib/team-coach";

// The top of a team coach's Home: one tile for each thing a team coach reaches for. Shown above the usual Home. With several teams there is a small switcher (never silently the first).
export function TeamCoachHome({ teams, initialId }: { teams: TeamChoice[]; initialId: string }) {
  const [id, setId] = useState(initialId);
  const team = teams.find((t) => t.id === id) ?? teams[0];
  if (!team) return null;
  const tiles = teamHomeTiles(team.id);
  return (
    <section className="mb-8" aria-labelledby="team-home-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="team-home-heading" className="font-display font-bold text-2xl uppercase leading-none">
          {team.name}
        </h2>
        {teams.length > 1 && (
          <label className="font-body text-xs text-steel">
            <span className="sr-only">Choose a team</span>
            <select value={team.id} onChange={(e) => setId(e.target.value)} className="h-11 bg-graphite border border-steel/30 text-chalk px-2.5 font-body text-sm">
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <li key={t.key}>
            <Link prefetch={false}
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
