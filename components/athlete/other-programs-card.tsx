import Link from "next/link";
import type { MyProgramRow } from "@/lib/my-training";

// A person who trains in more than one group sees their programs from every group on Home and goes straight to the one they want: no "which group?" first. This lists the programs that are
// in OTHER groups than the one open now (this group's own program is already the card below).
export function OtherProgramsCard({ programs }: { programs: MyProgramRow[] }) {
  if (programs.length === 0) return null;
  return (
    <section className="border border-steel/30 bg-surface/40 px-4 py-3">
      <p className="font-body text-xs text-steel uppercase tracking-wide">Your other programs</p>
      <ul className="mt-1 divide-y divide-steel/15">
        {programs.map((p) => (
          <li key={p.programId}>
            <Link href={`/groups/${p.groupId}`} className="flex items-center justify-between gap-3 py-2.5 active:bg-surface/60">
              <span className="font-body text-sm text-chalk truncate">{p.programName}</span>
              <span className="font-body text-xs text-steel shrink-0">{p.groupName}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
