import Link from "next/link";
import { FEE_NOTICE_LINES, feePercentLabel } from "@/lib/platform-fee";

// What a coach pays Spotlight on their clients' payments, in plain words (Ron, Nov 20): where they set up payments, on Plan & Billing and on the public pricing page. `currentPercent`: this
// organization's rate today, said first when it is known. The words are lib/platform-fee.ts FEE_NOTICE_LINES (a draft Ron approves).
export function FeeNotice({ currentPercent, showPricingLink = true, className = "" }: { currentPercent?: number | null; showPricingLink?: boolean; className?: string }) {
  return (
    <div className={`font-body text-xs text-steel space-y-1 max-w-[70ch] ${className}`} data-fee-notice>
      {currentPercent != null && <p className="text-chalk">Spotlight&apos;s fee for you today: {feePercentLabel(currentPercent)} of each client payment made in the app.</p>}
      {FEE_NOTICE_LINES.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {showPricingLink && (
        <p>
          <Link href="/pricing" className="underline underline-offset-2">
            See pricing
          </Link>
        </p>
      )}
    </div>
  );
}
