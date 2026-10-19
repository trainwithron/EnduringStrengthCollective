import Link from "next/link";

// "Requests (n)" in the Clients page header: always there, with a badge when someone is waiting.
export function RequestsLink({ count }: { count: number | null }) {
  const waiting = (count ?? 0) > 0;
  return (
    <Link
      href="/clients/requests"
      className={`inline-flex items-center gap-2 h-11 px-4 border font-body text-sm ${waiting ? "border-rust text-chalk" : "border-steel/40 text-steel"}`}
      aria-label={waiting ? `Requests, ${count} waiting` : "Requests"}
    >
      Requests{count !== null && <span> ({count})</span>}
      {waiting && <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-rust" />}
    </Link>
  );
}
