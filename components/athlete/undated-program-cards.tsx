import { ProgramCard } from "@/components/athlete/program-card-list";
import type { ProgramCardVisualData } from "@/lib/program-card-data";
import type { UndatedProgramCard } from "@/lib/client-calendar";

// Above a client's Calendar: one card per active program the coach did not put on dates (Ron, Oct 19: "he's not in the gym the same days every week").
// Its cover, its name and where they pick up; tapping it opens the whole program, already on that week. One card fills the width; more scroll sideways.
export function UndatedProgramCards({ groupId, programs, visuals }: { groupId: string; programs: UndatedProgramCard[]; visuals: Record<string, ProgramCardVisualData> }) {
  if (programs.length === 0) return null;
  const single = programs.length === 1;
  return (
    <section className="pt-4" aria-label="Programs without dates" data-undated-programs>
      <div className={single ? "px-5" : "flex gap-3 overflow-x-auto px-5 snap-x snap-mandatory pb-1"}>
        {programs.map((p) => (
          <ProgramCard
            key={p.id}
            groupId={groupId}
            program={{ id: p.id, name: p.name, workoutCount: p.workoutCount, coverImagePath: p.coverImagePath }}
            visual={visuals[p.id]}
            subline={p.upNext}
            className={single ? "w-full" : "w-[72%] max-w-[280px] shrink-0 snap-start"}
          />
        ))}
      </div>
    </section>
  );
}
