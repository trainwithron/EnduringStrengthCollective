import Link from "next/link";
import type { ProgramCardData } from "@/components/coach/desktop/program-card-grid";

// The coach's Programs on a PHONE: one simple card per program (name, Active or Draft, how many days, who it is for), tap to open. No toolbar, no filters, no import launcher: the desktop page keeps those.
export function ProgramsPhoneList({ programs, groupIdFor, newProgramGroupId }: { programs: ProgramCardData[]; groupIdFor: (p: ProgramCardData) => string; newProgramGroupId: string }) {
  return (
    <section className="px-5 pb-8">
      <Link href={`/groups/${newProgramGroupId}/programs/new`} className="flex items-center justify-center h-12 mb-4 bg-rust text-graphite font-display uppercase text-sm font-bold">
        New program
      </Link>
      {programs.length === 0 ? (
        <p className="font-body text-sm text-steel border border-steel/20 p-4">No programs yet.</p>
      ) : (
        <ul className="space-y-2">
          {programs.map((p) => (
            <li key={p.id}>
              <Link href={`/groups/${groupIdFor(p)}/programs/${p.id}`} className="block border border-steel/25 p-4 active:border-rust">
                <span className="flex items-start justify-between gap-3">
                  <span className="font-display font-bold text-lg leading-tight">{p.name}</span>
                  <span className={`shrink-0 font-body text-xs uppercase tracking-wide font-bold ${p.isActive && !p.aiDraft ? "text-rust" : "text-steel"}`}>{p.aiDraft ? "Draft" : p.isActive ? "Active" : "Not active"}</span>
                </span>
                <span className="block font-body text-sm text-steel mt-1">
                  {p.workoutCount} {p.workoutCount === 1 ? "day" : "days"}
                  {p.athleteName ? ` · for ${p.athleteName}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
