"use client";

import { useRouter } from "next/navigation";
import { writeViewOverride, type ViewOverride } from "@/lib/pwa";
import { Monitor, Smartphone } from "lucide-react";

// A coach's manual, sticky choice of shell — full desktop coaching tools
// vs. the lighter client-facing app (bottom tab bar, today's workout,
// roster). Not gated on device/viewport: a coach on a tablet might want
// the full shell for planning, or the client-facing one while standing
// with a client mid-session, and either choice should stick across
// navigation and reload until flipped back — see lib/pwa-server.ts's
// prefersAthleteStyleView() for where the override actually takes
// effect. This is a general, always-available version of "View as
// Client" — it renders the coach's OWN generic client-facing shell, not
// any specific client's data.
export function ViewModeToggle({
  targetMode,
  label,
  title,
  collapsed,
  variant = "sidebar",
  groupId,
}: {
  targetMode: Exclude<ViewOverride, null>;
  label: string;
  // Distinct from `label` on purpose — this control's name ("Client-
  // Facing Mode") reads as near-identical to the unrelated "View as
  // Client" control that sits right next to it in the header (that one
  // impersonates one specific real client; this one just previews the
  // coach's own generic client-style shell). Defaults to `label` when
  // the distinction isn't worth spelling out at a given call site.
  title?: string;
  collapsed?: boolean;
  // "sidebar": plain text+icon row, matching the desktop shell's other
  // footer links. "button": a bordered box matching the mobile hub's
  // "View as Client"/"My Groups" buttons it sits alongside there.
  variant?: "sidebar" | "button";
  // Most pages the desktop shell's sidebar renders on (Programs,
  // Business, Clients, Calendar, ...) never branch on the override at
  // all — only the group hub route does — so setting the cookie and
  // just refreshing the CURRENT page produced no visible change
  // whatsoever (a real, confirmed bug: the control looked dead). Always
  // landing on the group hub after the switch guarantees the coach
  // actually sees the mode they just picked.
  groupId: string;
}) {
  const router = useRouter();
  const Icon = targetMode === "mobile" ? Smartphone : Monitor;

  function handleClick() {
    writeViewOverride(targetMode);
    router.push(`/groups/${groupId}`);
    router.refresh();
  }

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={handleClick}
        title={title ?? label}
        className="flex items-center gap-1.5 h-9 px-3 border border-steel/30 text-chalk active:border-rust active:text-rust transition-colors shrink-0"
      >
        <Icon className="w-4 h-4 shrink-0" strokeWidth={2.25} />
        <span className="font-body text-sm">{label}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={title ?? label}
      className={`flex items-center gap-2 font-body text-xs text-steel active:text-chalk transition-colors ${
        collapsed ? "justify-center w-full" : ""
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
      {!collapsed && label}
    </button>
  );
}
