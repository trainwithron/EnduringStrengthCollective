"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

// In the left panel next to what needs attention: "2 people asked to train with you." Shown only when someone is waiting; read through the database function (the coach cannot read the requests table itself).
export function PendingRequestsLine({ groupId }: { groupId: string }) {
  const [count, setCount] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserClient();
        // the organization the coach is working in (the one this page's group belongs to)
        const { data: g } = await supabase.from("groups").select("organization_id").eq("id", groupId).maybeSingle();
        const { data, error } = await supabase.rpc("coach_client_request_count", { p_org: (g as { organization_id?: string | null } | null)?.organization_id ?? null });
        if (!cancelled && !error && typeof data === "number") setCount(data);
      } catch {
        // no line is better than a wrong one
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);
  if (count <= 0) return null;
  return (
    <Link href="/clients/requests" className="block border border-rust/60 bg-surface/30 p-3 mb-3 font-body text-xs text-chalk leading-snug">
      {count === 1 ? "1 person asked" : `${count} people asked`} to train with you. <span className="text-rust underline underline-offset-2">Review</span>
    </Link>
  );
}
