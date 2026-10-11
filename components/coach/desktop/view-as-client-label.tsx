"use client";

import Link from "next/link";
import { useTerm } from "@/components/coach/terminology-provider";

// The coach's own word for a client ("client", "athlete", "member"...), for the View-as pages and buttons.
export function ViewAsClientLabel() {
  const term = useTerm();
  return <>{term("client")}</>;
}

// "View as client": opens the read-only preview of what the client sees.
export function ViewAsClientLink({ href, className }: { href: string; className?: string }) {
  const term = useTerm();
  return (
    <Link href={href} className={className ?? "inline-flex items-center justify-center min-h-11 sm:h-9 font-body text-xs text-chalk border border-steel/40 px-3 font-medium"}>
      View as {term("client")}
    </Link>
  );
}
