"use client";

import { useEffect, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { isTabletUA } from "@/lib/phone-coach-routes";
import { writeViewOverride } from "@/lib/pwa";

// Ron, Oct 19: "tab should be able to switch between both". Only on a TABLET: in the phone app, "Computer layout"; in the computer layout, "Phone layout". The choice is the existing
// coach_view_override cookie (it wins over the device everywhere: lib/phone-coach-routes.ts isPhoneView). A phone or a computer never sees either.
export function useIsTablet(): boolean {
  const [tablet, setTablet] = useState(false);
  useEffect(() => {
    setTablet(isTabletUA(navigator.userAgent, navigator.maxTouchPoints));
  }, []);
  return tablet;
}

export function TabletLayoutSwitch({ to, variant = "row" }: { to: "desktop" | "mobile"; variant?: "row" | "rail" }) {
  const tablet = useIsTablet();
  if (!tablet) return null;
  const label = to === "desktop" ? "Computer layout" : "Phone layout";
  const Icon = to === "desktop" ? Monitor : Smartphone;
  function go() {
    writeViewOverride(to);
    // The computer layout opens on Home; the phone app opens where the coach is (its middleware sends a computer-only page to the closest phone page).
    window.location.assign(to === "desktop" ? "/dashboard" : window.location.pathname + window.location.search);
  }
  if (variant === "rail") {
    return (
      <button type="button" onClick={go} aria-label={label} title={label} className="w-11 h-11 flex items-center justify-center text-steel hover:text-chalk" data-tablet-switch={to}>
        <Icon className="w-4 h-4" strokeWidth={2.25} />
      </button>
    );
  }
  return (
    <button type="button" onClick={go} className="flex items-center gap-3 h-11 px-5 w-full font-body text-sm text-chalk active:text-rust" data-tablet-switch={to}>
      <Icon className="w-4 h-4 shrink-0 text-steel" strokeWidth={2.25} />
      {label}
    </button>
  );
}
