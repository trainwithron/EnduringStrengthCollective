import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { SignOutButton } from "@/components/group/sign-out-button";
import { EditDisplayName } from "@/components/athlete/edit-display-name";
import { PushNotificationToggle } from "@/components/athlete/push-notification-toggle";
import { WearablePlaceholder } from "@/components/athlete/wearable-placeholder";
import { BuyCreditsButton } from "@/components/athlete/buy-credits-button";
import { SubscribeButton } from "@/components/athlete/subscribe-button";
import { ManageBillingLink } from "@/components/athlete/manage-billing-link";

export default async function SettingsPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: profile }, { data: membership }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("id", user.id)
      .single(),
    supabase
      .from("group_memberships")
      .select("role")
      .eq("group_id", params.groupId)
      .eq("profile_id", user.id)
      .maybeSingle(),
  ]);
  const isCoach = membership?.role === "coach";

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to group
        </Link>
        <h1 className="font-display font-bold text-4xl leading-none mt-3 uppercase">
          Settings
        </h1>
      </header>

      <section className="px-5 pt-6 flex items-center gap-3">
        <Avatar name={profile?.full_name ?? "?"} url={profile?.avatar_url ?? null} />
        <div className="flex-1">
          <EditDisplayName initialName={profile?.full_name ?? ""} />
          <p className="font-body text-xs text-steel mt-0.5">{user.email}</p>
        </div>
      </section>

      <section className="px-5 pt-8">
        <div className="pb-4 border-b border-steel/20">
          <PushNotificationToggle />
        </div>
        <div className="pb-4 border-b border-steel/20 pt-4">
          <WearablePlaceholder />
        </div>
        {!isCoach && (
          <div className="pb-4 border-b border-steel/20 pt-4">
            <p className="font-body text-sm mb-3">Billing</p>
            <div className="flex flex-wrap items-center gap-3">
              <BuyCreditsButton groupId={params.groupId} />
              <SubscribeButton groupId={params.groupId} />
            </div>
            <div className="mt-3">
              <ManageBillingLink />
            </div>
          </div>
        )}
        <div className="border-t border-steel/20 pt-4">
          <Link
            href={`/groups/${params.groupId}/tools/one-rep-max`}
            className="font-body text-sm text-rust"
          >
            1RM Calculator
          </Link>
        </div>
        <div className="border-t border-steel/20 pt-4 mt-4">
          <Link
            href={`/groups/${params.groupId}/tools/macro-calculator`}
            className="font-body text-sm text-rust"
          >
            Macro Calculator
          </Link>
        </div>
        <div className="border-t border-steel/20 pt-4 mt-4">
          <Link
            href={`/groups/${params.groupId}/referrals`}
            className="font-body text-sm text-rust"
          >
            Referral Directory
          </Link>
        </div>
        <div className="border-t border-steel/20 pt-4 mt-4">
          <Link
            href={`/groups/${params.groupId}/leaderboard`}
            className="font-body text-sm text-rust"
          >
            Leaderboard
          </Link>
        </div>
        {isCoach && (
          <div className="border-t border-steel/20 pt-4 mt-4">
            <Link
              href={`/groups/${params.groupId}/dashboard`}
              className="font-body text-sm text-rust"
            >
              Coach Dashboard &rarr;
            </Link>
            <p className="font-body text-xs text-steel mt-1">
              Programs, clients, business tools — the full site.
            </p>
          </div>
        )}
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
