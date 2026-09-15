"use client";

import { useRouter } from "next/navigation";
import { Smartphone } from "lucide-react";
import { writeViewOverride } from "@/lib/pwa";

// The escape hatch CoachHomeShell was missing entirely. Unlike
// CoachDesktopShell (which renders ViewModeToggle and needs a groupId to
// push to), this page is genuinely group-agnostic — there's no single
// group to jump into. Clearing the override and re-landing on /dashboard
// is enough: with no override set, /dashboard's own prefersAthleteStyleView()
// check re-evaluates against the real device, and its existing mobile
// redirect (app/dashboard/page.tsx) sends a real phone straight to the
// coach's group hub — no new redirect logic needed here, just letting
// that existing logic run with a clean cookie.
//
// Real bug this fixes: a coach with a stuck coach_view_override=desktop
// on a real phone, with no last_group cookie set, landed on this exact
// shell with zero way off it — no ViewModeToggle, no bottom tab bar,
// nothing. Confirmed live: "no nav buttons on the bottom, can't leave
// home page."
export function ExitDesktopModeButton() {
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
      className="flex items-center gap-2 font-body text-xs text-steel active:text-chalk transition-colors"
    >
      <Smartphone className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
      Switch to mobile view
    </button>
  );
}
