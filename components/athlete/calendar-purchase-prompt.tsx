import { PackagePicker, type PackageOption } from "./package-picker";

// The caller keeps its existing creditBalance <= 0 gate unchanged — this
// component doesn't need to know about credit balance at all, since the
// caller simply doesn't render it when credits > 0 and no subscription
// exists. It only decides between the two states: already subscribed
// (show the renewal date, a buy prompt doesn't make sense) or not
// (show the same package picker Settings already uses, reused directly
// rather than duplicated).
export function CalendarPurchasePrompt({
  activeSubscription,
  packages,
}: {
  activeSubscription: { currentPeriodEnd: string | null } | null;
  packages: PackageOption[];
}) {
  if (activeSubscription) {
    return (
      <p className="font-body text-xs text-steel">
        Membership renews{" "}
        {activeSubscription.currentPeriodEnd
          ? new Date(activeSubscription.currentPeriodEnd).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "soon"}
        .
      </p>
    );
  }

  return <PackagePicker packages={packages} />;
}
