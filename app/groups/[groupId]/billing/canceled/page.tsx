import Link from "next/link";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";

export default async function BillingCanceledPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24 flex flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display font-bold text-3xl uppercase">Checkout canceled</h1>
      <p className="font-body text-sm text-steel mt-3 max-w-[40ch]">
        No charge was made. You can try again any time from Settings.
      </p>
      <Link
        href={`/groups/${params.groupId}/settings`}
        className="mt-6 h-11 px-5 flex items-center bg-rust text-graphite font-body text-sm font-medium"
      >
        Back to Settings
      </Link>
      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
