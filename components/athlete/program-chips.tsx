import Link from "next/link";

// A client with two or more active programs: one chip per program under the Calendar title, the one on screen marked, each a link to that program's own calendar. (The calendar shows one program at a time.)
export function ProgramChips({ groupId, programs, currentId }: { groupId: string; programs: { id: string; name: string }[]; currentId: string }) {
  if (programs.length < 2) return null;
  return (
    <nav aria-label="Your programs" className="mt-3 overflow-x-auto">
      <ul className="flex gap-2 w-max">
        {programs.map((p) => {
          const on = p.id === currentId;
          return (
            <li key={p.id}>
              <Link
                href={`/groups/${groupId}/programs/${p.id}/calendar`}
                aria-current={on ? "page" : undefined}
                className={`inline-flex items-center min-h-11 px-4 rounded-full font-body text-sm whitespace-nowrap border ${on ? "bg-surface text-chalk border-steel/50" : "text-steel border-steel/25"}`}
              >
                {p.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
