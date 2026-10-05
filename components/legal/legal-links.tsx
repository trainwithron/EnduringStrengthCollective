import Link from "next/link";

// The small row of links to the legal pages shown at the bottom of signup, login, invite, claim, intake and the
// landing page.
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <p className={`font-body text-xs text-steel flex flex-wrap justify-center gap-x-4 gap-y-1 ${className}`}>
      <Link href="/beta" className="underline underline-offset-2">
        Beta notice
      </Link>
      <Link href="/terms" className="underline underline-offset-2">
        Terms
      </Link>
      <Link href="/privacy" className="underline underline-offset-2">
        Privacy
      </Link>
      <Link href="/refunds" className="underline underline-offset-2">
        Refunds
      </Link>
    </p>
  );
}
