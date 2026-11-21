import Link from "next/link";
import { REQUESTS_PATH } from "@/lib/requests-center";
import { createServerClient } from "@/lib/supabase/server";
import { requestsWaitingForSignedIn } from "@/lib/requests-center-server";

// "Requests (n)" in the Clients page header: always there, with a badge when something is waiting. The number is the one waiting number (Nov 21, PH1): every kind the Requests page
// lists (sessions asked for or moved, late changes, schedule changes, people asking to train), read here for the signed-in coach, so it matches the Requests page and Spotlight.
// `count` (what a page read before, people asking to train only) is used only when that read fails.
export async function RequestsLink({ count: fallback = null }: { count?: number | null }) {
  let count: number | null = null;
  try {
    count = await requestsWaitingForSignedIn(await createServerClient());
  } catch {
    count = null;
  }
  if (count === null) count = fallback;
  const waiting = (count ?? 0) > 0;
  return (
    <Link
      href={REQUESTS_PATH}
      className={`inline-flex items-center gap-2 h-11 px-4 border font-body text-sm ${waiting ? "border-rust text-chalk" : "border-steel/40 text-steel"}`}
      aria-label={waiting ? `Requests, ${count} waiting` : "Requests"}
    >
      Requests{count !== null && <span> ({count})</span>}
      {waiting && <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-rust" />}
    </Link>
  );
}
