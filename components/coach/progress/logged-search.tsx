import Link from "next/link";

// Search for the Logged workouts list on Overview: by exercise name or part of a date, and between two dates. A plain form (no script needed): it reloads this page with the search in the address, so
// a search can be bookmarked or reloaded. Clear takes it away.
export function LoggedSearch({ action, q, from, to }: { action: string; q: string; from: string; to: string }) {
  const searching = q !== "" || from !== "" || to !== "";
  const field = "mt-1 block h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm";
  return (
    <form method="get" action={action} className="mb-3 flex flex-wrap items-end gap-3" role="search" aria-label="Search logged workouts">
      <label className="font-body text-xs text-steel">
        Exercise or date
        <input type="search" name="q" defaultValue={q} placeholder="Squat, or 2026-08" className={`${field} w-48`} />
      </label>
      <label className="font-body text-xs text-steel">
        From
        <input type="date" name="from" defaultValue={from} className={field} />
      </label>
      <label className="font-body text-xs text-steel">
        To
        <input type="date" name="to" defaultValue={to} className={field} />
      </label>
      <button type="submit" className="min-h-11 border border-steel/40 px-3 font-body text-sm text-chalk">
        Search
      </button>
      {searching && (
        <Link href={action} className="min-h-11 inline-flex items-center font-body text-sm text-rust underline underline-offset-2">
          Clear
        </Link>
      )}
    </form>
  );
}
