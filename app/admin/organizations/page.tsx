import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { NewOrganizationForm } from "@/components/admin/new-organization-form";

export default async function AdminOrganizationsPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_platform_admin) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">You don&apos;t have access to this page.</p>
      </main>
    );
  }

  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, slug, created_at, owner_id, profiles!organizations_owner_id_fkey ( full_name )")
    .order("created_at", { ascending: false });

  const { data: groupCounts } = await supabase.from("groups").select("organization_id");
  const groupCountByOrg = new Map<string, number>();
  for (const g of groupCounts ?? []) {
    groupCountByOrg.set(g.organization_id, (groupCountByOrg.get(g.organization_id) ?? 0) + 1);
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-8 md:px-10">
      <div className="max-w-3xl mx-auto">
        <div className="pb-6 border-b border-steel/20 mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-3xl uppercase leading-none">Organizations</h1>
            <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
              Every organization on the platform — visible only to you. Create a new one blank, or
              starting from an existing org&apos;s branding, to build out a prospective client before
              handing it over.
            </p>
          </div>
          <NewOrganizationForm
            existingOrgs={(orgs ?? []).map((o) => ({ id: o.id, name: o.name }))}
            ownerId={user.id}
          />
        </div>

        <div className="divide-y divide-steel/15">
          {(orgs ?? []).map((org) => (
            <div key={org.id} className="py-3 flex items-center justify-between gap-4">
              <div>
                <p className="font-body text-sm font-medium">{org.name}</p>
                <p className="font-body text-xs text-steel">
                  /{org.slug} · Owner: {(org.profiles as any)?.full_name ?? "Unknown"} ·{" "}
                  {groupCountByOrg.get(org.id) ?? 0} group{groupCountByOrg.get(org.id) === 1 ? "" : "s"} ·
                  Created {new Date(org.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
          {(orgs ?? []).length === 0 && (
            <p className="font-body text-sm text-steel py-3">No organizations yet.</p>
          )}
        </div>

        <p className="font-body text-xs text-steel mt-8">
          <Link href="/" className="text-rust">
            ← Back home
          </Link>
        </p>
      </div>
    </main>
  );
}
