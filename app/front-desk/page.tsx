import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import { SignOutButton } from "@/components/group/sign-out-button";
import { FrontDeskScreen } from "@/components/front-desk/front-desk-screen";
import type { FrontDeskOrg } from "@/lib/front-desk";

// The organization-wide check-in screen for the front desk (Release T1). A bare tablet page like the group kiosk: no menus, nothing to tap out through. Reachable by front-desk staff and by the organization's own
// owner, admins and coaches (the database decides: front_desk_orgs()). It never reads clients itself; the search runs one name at a time through the database's front-desk functions.
export default async function FrontDeskPage(props: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/front-desk");

  const { data, error } = await supabase.rpc("front_desk_orgs");
  if (isReadFailure(error)) return <LoadFailedPage />;
  const orgs = (data ?? []) as FrontDeskOrg[];

  if (orgs.length === 0) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-display font-bold text-2xl uppercase leading-tight">No front desk here</p>
        <p className="font-body text-sm text-steel max-w-[36ch]">You are not on an organization&apos;s front desk. Ask the owner to invite you, then open this page again.</p>
        <SignOutButton />
      </main>
    );
  }

  const chosen = orgs.find((o) => o.organization_id === org) ?? (orgs.length === 1 ? orgs[0] : null);
  if (!chosen) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="font-display font-bold text-2xl uppercase leading-tight">Which front desk?</p>
        <ul className="w-full max-w-xs space-y-2">
          {orgs.map((o) => (
            <li key={o.organization_id}>
              <a href={`/front-desk?org=${o.organization_id}`} className="block h-14 leading-[3.5rem] bg-surface border border-steel/30 font-body text-lg">
                {o.name}
              </a>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return <FrontDeskScreen organizationId={chosen.organization_id} organizationName={chosen.name} />;
}
