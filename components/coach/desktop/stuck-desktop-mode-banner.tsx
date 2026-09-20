"use client";

import { useRouter } from "next/navigation";
import { Smartphone } from "lucide-react";
import { writeViewOverride } from "@/lib/pwa";

// Real bug fix, Ron's own phone: "Desktop Mode" is a sticky per-device
// override (lib/pwa-server.ts's prefersAthleteStyleView), and the
// existing way back (ExitDesktopModeButton, a plain link at the bottom
// of CoachHomeShell's sidebar, or a rail icon hidden below lg: on
// CoachDesktopShell) is easy to miss on a real, narrow phone — which
// reads exactly like "half the app is missing" (no Spot button, an
// unstyled desktop layout) rather than "you're one tap from your real
// Home." This is a full-width, unmissable, top-of-page banner shown
// only when the real device is mobile despite the override (see the
// server-side check in app/dashboard/page.tsx) — same one-tap fix as
// ExitDesktopModeButton, just impossible to scroll past unnoticed.
export function StuckDesktopModeBanner() {
  const router = useRouter();

  function handleClick() {
    writeViewOverride(null);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center justify-center gap-2 h-11 mb-4 bg-rust text-graphite font-body text-sm font-bold active:bg-rust/80 transition-colors"
    >
      <Smartphone className="w-4 h-4 shrink-0" strokeWidth={2.5} />
      You&apos;re viewing Desktop Mode — tap to switch back to your phone view
    </button>
  );
}
