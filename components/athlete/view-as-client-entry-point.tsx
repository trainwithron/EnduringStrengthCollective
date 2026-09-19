import Link from "next/link";
import { LayoutGrid } from "lucide-react";

// the_spot_dropdown_widget_redesign_sept16.md — "View as Client" used to
// live here as its own button; it now lives inside the Spot's default
// panel (components/coach/mobile/spot-clients-groups-panel.tsx) as a
// direct Clients list, since the Spot replaces it as the coach's primary
// second access point. "My Groups" stays here — a different intent
// (jump to a different group entirely, not impersonate a client),
// unaffected by that move.
export function ViewAsClientEntryPoint() {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-1.5 h-9 px-3 border border-steel/30 text-chalk active:border-rust active:text-rust transition-colors"
    >
      <LayoutGrid className="w-4 h-4 shrink-0" strokeWidth={2.25} />
      <span className="font-body text-sm">My Groups</span>
    </Link>
  );
}
