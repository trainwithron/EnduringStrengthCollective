import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { HomeProgramCard } from "@/lib/home-programs";

// "Your programs" on a client's Home, right under today's workout: every active program as a card (its name, where they are up to, how many are done). Tapping one opens the whole program: every week, pick the week and the day.
export function MyProgramsBlock({ groupId, programs }: { groupId: string; programs: HomeProgramCard[] }) {
  return (
    <section aria-label="Your programs">
      <h2 className="font-body text-xs uppercase tracking-wide text-steel mb-2">{programs.length === 1 ? "Your program" : "Your programs"}</h2>
      {programs.length === 0 ? (
        <p className="font-body text-sm text-steel py-2">Your coach is setting up your program. It will show up here as soon as it is ready.</p>
      ) : (
        <ul className="space-y-2">
          {programs.map((p) => (
            <li key={p.id}>
              <Link href={`/groups/${groupId}/programs/${p.id}`} className="flex items-center gap-3 min-h-[64px] border border-steel/25 bg-surface/40 rounded-token-lg px-4 py-3 active:bg-surface/60">
                <span className="min-w-0 flex-1">
                  <span className="block font-body text-base font-semibold leading-tight break-words">{p.name}</span>
                  <span className="block font-body text-sm text-steel mt-0.5">
                    {p.upNext}
                    {p.total > 0 && (
                      <span>
                        {" "}
                        {"·"} {p.done} of {p.total} done
                      </span>
                    )}
                  </span>
                </span>
                <ChevronRight className="w-5 h-5 text-steel shrink-0" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
