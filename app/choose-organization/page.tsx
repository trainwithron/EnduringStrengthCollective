import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { coachedOrgs, getCoachedGroups } from "@/lib/coach-groups";

// Which organization are you working in? Shown to a coach who runs more than one organization when nothing valid is remembered (a new browser, or the remembered workspace is gone). Only organization
// NAMES are listed: nothing of any organization (clients, programs, money) is shown until one is chosen. Choosing sets the workspace, and every coach page follows it until they choose another.
export default async function ChooseOrganizationPage(props: { searchParams: Promise<{ next?: string }> }) {
  const search = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orgs = coachedOrgs(await getCoachedGroups(supabase, user.id));
  const next = safeNext(search.next);
  if (orgs.length === 0) redirect("/");
  if (orgs.length === 1) redirect(`/choose-organization/select?org=${orgs[0].id}&next=${encodeURIComponent(next)}`);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Which organization?</h1>
        <p className="font-body text-sm text-steel mt-2">You run more than one. Pick the one you are working in; everything you see will be that organization only.</p>
        <ul className="mt-6 space-y-2">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link
                href={`/choose-organization/select?org=${o.id}&next=${encodeURIComponent(next)}`}
                className="block min-h-11 px-4 py-3 border border-steel/25 bg-surface font-body text-base text-chalk hover:border-rust active:border-rust"
              >
                {o.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

// Only a path inside this app (never another address).
function safeNext(raw: string | undefined): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
}
