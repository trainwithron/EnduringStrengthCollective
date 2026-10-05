"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";
import { loadStartInputs, pickStartGroup } from "@/lib/start-group";
import { isStandaloneDisplay, isMobileUserAgent } from "@/lib/pwa";

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
      // Home, not a settings page: the desktop Home for a coach at a computer, the phone Home for a phone or the installed app.
      const membership = pickStartGroup(await loadStartInputs(supabase, user.id));
      if (!membership) {
        router.push("/");
      } else {
        const phone = membership.role !== "coach" || isStandaloneDisplay() || isMobileUserAgent();
        router.push(phone ? `/groups/${membership.group_id}` : "/dashboard");
      }
      router.refresh();
    });
  }, [router]);

  if (checking || hasSession) return null;

  return (
    <main className="min-h-screen flex items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <h1 className="font-display uppercase text-2xl font-bold">Link invalid or expired</h1>
        <p className="font-body text-steel text-sm mt-2">
          This link has expired or was already used. If you already confirmed, just{" "}
          <Link href="/login" className="text-rust">
            sign in
          </Link>
          . If not, sign in with your email and password and we will offer to send a new confirmation email.
        </p>
      </div>
    </main>
  );
}
