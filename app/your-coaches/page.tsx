import Link from "next/link";
import { redirect } from "next/navigation";
import { createCrossOrgServerClient as createServerClient } from "@/lib/supabase/server";
import { loadYourCoaches } from "@/lib/your-coaches";

// Every coach a client trains with, one row each, with a link into that space. For a client with more than one coach this is where they switch.
export default async function YourCoachesPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=%2Fyour-coaches");
  const { spaces, failed } = await loadYourCoaches(supabase, user.id);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Your coaches</h1>
        <p className="font-body text-sm text-steel mt-2">Pick who you are training with. Each coach has their own space, and what you do in one is not shown in the others.</p>
        {failed && (
          <p className="font-body text-sm text-rust mt-4" role="alert">
            Some of your spaces could not be loaded. Reload the page to try again.
          </p>
        )}
        {!failed && spaces.length === 0 && <p className="font-body text-sm text-steel mt-6">You are not training with a coach yet. Ask your coach to add you.</p>}
        <ul className="mt-6 space-y-2">
          {spaces.map((s) => (
            <li key={s.groupId}>
              <Link href={`/groups/${s.groupId}`} className="block min-h-11 px-4 py-3 border border-steel/25 bg-surface hover:border-rust active:border-rust">
                <span className="block font-body text-base text-chalk">{s.coachNames.length > 0 ? s.coachNames.join(", ") : s.groupName}</span>
                <span className="block font-body text-xs text-steel mt-0.5">
                  {s.oneOnOne ? "One-on-one" : s.groupName}
                  {s.organizationName ? ` · ${s.organizationName}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
