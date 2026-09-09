import Link from "next/link";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";

export default async function BillingSuccessPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ kind?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const isSubscription = searchParams.kind === "subscription";

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24 flex flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display font-bold text-3xl uppercase">Payment complete</h1>
      <p className="font-body text-sm text-steel mt-3 max-w-[40ch]">
        {isSubscription
          ? "Your membership is active. Welcome aboard."
          : "Your session credits have been added to your account and are ready to use."}
      </p>
      <Link
        href={`/groups/${params.groupId}`}
        className="mt-6 h-11 px-5 flex items-center bg-rust text-graphite font-body text-sm font-medium"
      >
        Back to Home
      </Link>
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
