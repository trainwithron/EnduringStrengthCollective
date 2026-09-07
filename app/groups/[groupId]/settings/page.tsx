import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { SignOutButton } from "@/components/group/sign-out-button";

export default async function SettingsPage({
  params,
}: {
  params: { groupId: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .single();

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <h1 className="font-display font-bold text-4xl leading-none uppercase">
          Settings
        </h1>
      </header>

      <section className="px-5 pt-6 flex items-center gap-3">
        <Avatar name={profile?.full_name ?? "?"} url={profile?.avatar_url ?? null} />
        <div>
          <p className="font-body font-medium text-[15px]">
            {profile?.full_name ?? "—"}
          </p>
          <p className="font-body text-xs text-steel">{user.email}</p>
        </div>
      </section>

      <section className="px-5 pt-8">
        <div className="border-t border-steel/20 pt-4">
          <Link
            href={`/groups/${params.groupId}/tools/one-rep-max`}
            className="font-body text-sm text-rust"
          >
            1RM Calculator
          </Link>
        </div>
        <div className="border-t border-steel/20 pt-4 mt-4">
          <SignOutButton />
        </div>
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="w-14 h-14 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0">
      <span className="font-display text-lg">{initials}</span>
    </div>
  );
}
