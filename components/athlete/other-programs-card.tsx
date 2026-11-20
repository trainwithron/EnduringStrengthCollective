import Link from "next/link";
import type { MyProgramRow } from "@/lib/my-training";
import { ClientProgramMenu } from "@/components/coach/client-program-menu";

// "Your programs": every active program that is the person's own, from every group they train in. Tapping one opens it to RUN it (that group's Home: today's workout, Calendar, History),
// never the builder. A program made for the person has a small three-dot menu with one option, "Remove from my profile" (it takes the copy off their list; the template, anyone else's
// copy and every logged workout stay). A program a group shares with everyone is not theirs to remove, so it has no menu.
export function OtherProgramsCard({ programs }: { programs: MyProgramRow[] }) {
  if (programs.length === 0) return null;
  return (
    <section className="bg-surface rounded-card px-4 py-3">
      <p className="font-body text-[13px] font-semibold text-steel">Your other programs</p>
      <ul className="mt-1 divide-y divide-steel/15">
        {programs.map((p) => (
          <li key={p.programId} className="flex items-center gap-1">
            <Link href={`/groups/${p.groupId}`} className="flex flex-1 min-w-0 min-h-11 items-center justify-between gap-3 py-2.5 active:bg-surface-2">
              <span className="font-body font-semibold text-base leading-tight truncate text-chalk">{p.programName}</span>
              <span className="font-body text-xs text-steel shrink-0">{p.groupName}</span>
            </Link>
            {p.canRemove && <ClientProgramMenu programId={p.programId} programName={p.programName} clientName="" isActive aiDraft self />}
          </li>
        ))}
      </ul>
    </section>
  );
}
