"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmEmailStatus />
    </Suspense>
  );
}

function ConfirmEmailStatus() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    // The confirmation email's link establishes a real session client-side
    // (Supabase's own library reads it from the URL fragment on load) —
    // same pattern as /set-password. The account and its organization were
    // already created back at signup, so once a session is here, there's
    // just the same "find their first group, route in" lookup to do.
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setHasSession(false);
        setChecking(false);
        return;
      }
      setHasSession(true);
      const { data: membership } = await supabase
        .from("group_memberships")
        .select("group_id")
        .eq("profile_id", user.id)
        .limit(1)
        .maybeSingle();
      router.push(membership ? `/groups/${membership.group_id}/branding` : "/");
      router.refresh();
    });
  }, [router]);

  if (checking || hasSession) return null;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <h1 className="font-display uppercase text-2xl font-bold">Link invalid or expired</h1>
        <p className="font-body text-steel text-sm mt-2">
          Try{" "}
          <Link href="/signup" className="text-rust">
            signing up
          </Link>{" "}
          again, or{" "}
          <Link href="/login" className="text-rust">
            sign in
          </Link>{" "}
          if you already confirmed.
        </p>
      </div>
    </main>
  );
}
