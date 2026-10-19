import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { coachedOrgs, getCoachedGroups } from "@/lib/coach-groups";

export const metadata = { title: "Choose organization" };

// Which organization are you working in? Shown to a coach who runs more than one organization when nothing valid is remembered (a new browser, or the remembered workspace is gone). Only organization
// NAMES are listed: nothing of any organization (clients, programs, money) is shown until one is chosen. Choosing sets the workspace, and every coach page follows it until they choose another.
// FIX 4 (Ron, Oct 19: "It should be just a quick, are you sure you want to switch ...? Yes, no, and then yes, go. Obviously, no, stop."): with ?switch=<organization> (a page of another organization was
// opened) it is that one question: Yes switches and opens the page, No goes back to the current organization's Home. The links are plain links, so seeing them never switches anything (no prefetch).
export default async function ChooseOrganizationPage(props: { searchParams: Promise<{ next?: string; switch?: string }> }) {
  const search = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orgs = coachedOrgs(await getCoachedGroups(supabase, user.id));
  const next = safeNext(search.next);
  if (orgs.length === 0) redirect("/");
  const switchTo = search.switch ? orgs.find((o) => o.id === search.switch) : undefined;
  if (switchTo) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm" data-switch-confirm>
          <h1 className="font-display font-bold text-3xl uppercase leading-none break-words">Switch to {switchTo.name}?</h1>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <a
              href={`/choose-organization/select?org=${switchTo.id}&next=${encodeURIComponent(next)}`}
              className="min-h-11 flex items-center justify-center bg-rust text-graphite font-display uppercase text-base font-bold"
            >
              Yes
            </a>
            <a href="/dashboard" className="min-h-11 flex items-center justify-center border border-steel/40 text-chalk font-display uppercase text-base font-bold">
              No
            </a>
          </div>
        </div>
      </main>
    );
  }
  if (orgs.length === 1) redirect(`/choose-organization/select?org=${orgs[0].id}&next=${encodeURIComponent(next)}`);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Which organization?</h1>
        <p className="font-body text-sm text-steel mt-2">You run more than one. Pick the one you are working in; everything you see will be that organization only.</p>
        <ul className="mt-6 space-y-2">
          {orgs.map((o) => (
            <li key={o.id}>
              <a
                href={`/choose-organization/select?org=${o.id}&next=${encodeURIComponent(next)}`}
                className="block min-h-11 px-4 py-3 border border-steel/25 bg-surface font-body text-base text-chalk hover:border-rust active:border-rust"
              >
                {o.name}
              </a>
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
