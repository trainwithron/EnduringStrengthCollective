"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, CalendarDays, CreditCard, Dumbbell, MessageCircle, Sparkles, TrendingUp, Users, X } from "lucide-react";
import { BusinessMiniDashboard } from "@/components/coach/desktop/business-mini-dashboard";
import { CalendarMiniView } from "@/components/coach/desktop/calendar-mini-view";
import { ProgramMiniView } from "@/components/coach/desktop/program-mini-view";
import { AskSpotChatPanel } from "@/components/coach/ask-spot-chat-panel";
import { QuickPaymentPanel } from "./quick-payment-panel";
import { SpotBuilderPanel } from "./spot-builder-panel";
import { SpotClientsGroupsPanel } from "./spot-clients-groups-panel";
import { PushNotificationToggle } from "@/components/athlete/push-notification-toggle";
import { createBrowserClient } from "@/lib/supabase/client";
import { useTerm } from "@/components/coach/terminology-provider";
import { getCoachedGroups, LAST_WORKSPACE_GROUP_COOKIE } from "@/lib/coach-groups";
import { hubOrgs, hubStartOrgId, type HubOrg } from "@/lib/hub-orgs";

type TileKey = "clients" | "business" | "calendar" | "program" | "ask-spot" | "quick-payment";

const TILES: { key: TileKey; label: string; icon: typeof Users }[] = [
  { key: "clients", label: "Clients", icon: Users },
  { key: "business", label: "Business", icon: TrendingUp },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "program", label: "Program", icon: Dumbbell },
  { key: "ask-spot", label: "Ask Spot", icon: MessageCircle },
  { key: "quick-payment", label: "Quick payment", icon: CreditCard },
];

const SWIPE_DOWN_THRESHOLD = 56; // px — a short downward flick on the header closes the hub
const DRAG_THRESHOLD = 6;

// The single coach entry point on a phone (replaces the old 3-panel swipe
// Spot, the "More" edge tab and the mobile Ask Spot edge tab). The
// Spotlight button sits top-center on every coach mobile page; it opens a
// 2-column tile grid, and a tapped tile opens in place with a back arrow.
// Swipe down on the header or tap away to close. All tile content is the
// same components the desktop card stack and the old drawer used — this is
// only the shell around them.
export function CoachSpotHub({
  groupId,
  initialAthleteId,
  initialAthleteName,
}: {
  groupId: string;
  // Deep link from a client's own row/profile (?spotBuilder=...): opens
  // straight into Program -> Build with AI for that client.
  initialAthleteId?: string | null;
  initialAthleteName?: string | null;
}) {
  const [open, setOpen] = useState(!!initialAthleteId);
  const [view, setView] = useState<"grid" | TileKey>(initialAthleteId ? "program" : "grid");
  const [builderOpen, setBuilderOpen] = useState(!!initialAthleteId);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  // The group every tile acts on. A coach who runs more than one organization chooses the organization in the header; the tiles then use that organization's group.
  const [activeGroupId, setActiveGroupId] = useState(groupId);
  const [orgs, setOrgs] = useState<HubOrg[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const orgsRequested = useRef(false);
  useEffect(() => {
    // Only needed for the notification tile's test message.
    createBrowserClient()
      .auth.getUser()
      .then(({ data }) => setProfileId(data.user?.id));
  }, []);
  useEffect(() => {
    // Which organizations this coach has: read the first time the hub is opened (the dropdown is only visible then), not on every page.
    if (!open || orgsRequested.current) return;
    orgsRequested.current = true;
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled || !data.user) return;
      try {
        const groups = await getCoachedGroups(supabase, data.user.id);
        const remembered = document.cookie.split("; ").find((c) => c.startsWith(`${LAST_WORKSPACE_GROUP_COOKIE}=`))?.split("=")[1];
        const rememberedId = remembered ? decodeURIComponent(remembered) : null;
        const list = hubOrgs(groups, rememberedId);
        if (cancelled || list.length === 0) return;
        const start = hubStartOrgId(groups, rememberedId, groupId);
        setOrgs(list);
        setOrgId(start);
        // Starts on the organization Home is showing (the one chosen with the organization switcher), except when the hub was opened for one particular client.
        const startOrg = list.find((o) => o.orgId === start);
        if (startOrg && !initialAthleteId) setActiveGroupId(startOrg.anchorGroupId);
      } catch {
        // the hub keeps working on the page's own group
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, groupId, initialAthleteId]);

  function chooseOrg(nextOrgId: string) {
    const next = orgs.find((o) => o.orgId === nextOrgId);
    if (!next) return;
    setOrgId(next.orgId);
    setActiveGroupId(next.anchorGroupId);
    setBuilderOpen(false);
    try {
      // The same memory the organization switcher keeps, so Home follows the hub.
      document.cookie = `${LAST_WORKSPACE_GROUP_COOKIE}=${encodeURIComponent(next.anchorGroupId)}; path=/; max-age=${60 * 60 * 24 * 90}`;
    } catch {
      // not remembered; the hub still switched
    }
  }
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headerDrag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  function close() {
    setOpen(false);
    setView("grid");
    setBuilderOpen(false);
  }

  function toggle() {
    if (open) {
      close();
    } else {
      setView("grid");
      setBuilderOpen(false);
      setOpen(true);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function handleHeaderPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Controls inside the header (back, close) keep their own taps.
    if ((e.target as HTMLElement).closest("button, select")) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Unsupported/invalid pointer id — the bubbled move/up still track.
    }
    headerDrag.current = { x: e.clientX, y: e.clientY, moved: false };
  }

  function handleHeaderPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = headerDrag.current;
    if (!drag || e.buttons === 0) return;
    if (Math.abs(e.clientX - drag.x) > DRAG_THRESHOLD || Math.abs(e.clientY - drag.y) > DRAG_THRESHOLD) {
      drag.moved = true;
    }
  }

  function handleHeaderPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = headerDrag.current;
    headerDrag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // No-op if it was never captured.
    }
    if (!drag?.moved) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (dy > SWIPE_DOWN_THRESHOLD && Math.abs(dy) > Math.abs(dx)) close();
  }

  function goBack() {
    if (view === "program" && builderOpen) {
      setBuilderOpen(false);
      return;
    }
    setView("grid");
  }

  const activeTile = TILES.find((t) => t.key === view) ?? null;
  const t = useTerm();
  // The tile for the people a coach coaches uses the coach's own word ("Athletes", "Players"...), in proper case as a label.
  const labelOf = (tile: { key: TileKey; label: string }) => (tile.key === "clients" ? t("client", "plural", { cap: true }) : tile.label);
  const title = activeTile ? (view === "program" && builderOpen ? "Build with AI" : labelOf(activeTile)) : "Spotlight";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Spotlight"
        className="fixed top-3 left-1/2 -translate-x-1/2 z-40 h-10 w-10 rounded-token-circle bg-graphite/90 border border-rust/50 flex items-center justify-center active:border-rust transition-colors shadow-lg"
      >
        <Sparkles className="w-5 h-5 text-rust" strokeWidth={2.25} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30 bg-graphite/40 backdrop-blur-sm" aria-hidden="true" />
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Spotlight"
            className={`fixed top-16 left-1/2 -translate-x-1/2 z-40 w-[92vw] max-w-md bg-graphite/95 backdrop-blur border border-steel/30 rounded-token-lg shadow-2xl flex flex-col ${
              view === "grid" ? "max-h-[78vh]" : "h-[78vh] max-h-[640px]"
            }`}
          >
            <div
              onPointerDown={handleHeaderPointerDown}
              onPointerMove={handleHeaderPointerMove}
              onPointerUp={handleHeaderPointerUp}
              className="px-3 py-2.5 border-b border-steel/20 flex items-center gap-2 shrink-0 touch-none select-none"
            >
              {activeTile ? (
                <button
                  type="button"
                  onClick={goBack}
                  aria-label="Back"
                  className="w-8 h-8 flex items-center justify-center text-steel active:text-rust shrink-0"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              ) : null}
              <p className="font-body text-xs text-steel uppercase tracking-wide font-bold truncate flex-1">{title}</p>
              {orgs.length >= 2 && (
                <select
                  value={orgId ?? ""}
                  onChange={(e) => chooseOrg(e.target.value)}
                  aria-label="Organization"
                  className="h-8 max-w-[9rem] bg-graphite border border-steel/30 text-chalk font-body text-xs px-1 truncate"
                >
                  {orgs.map((o) => (
                    <option key={o.orgId} value={o.orgId}>
                      {o.orgName}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="w-8 h-8 flex items-center justify-center text-steel active:text-rust shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              {view === "grid" && (
                <div className="h-full overflow-y-auto grid grid-cols-2 gap-2 p-4">
                  {TILES.map((tile) => {
                    const Icon = tile.icon;
                    return (
                      <button
                        key={tile.key}
                        type="button"
                        onClick={() => setView(tile.key)}
                        className="border border-steel/20 p-4 flex flex-col items-center gap-2 active:border-rust active:bg-rust/5 transition-colors"
                      >
                        <Icon className="w-6 h-6 text-rust" strokeWidth={2.25} />
                        <span className="font-body text-sm text-chalk text-center">{labelOf(tile)}</span>
                      </button>
                    );
                  })}
                  {/* Shows only while notifications are off and could be turned on. */}
                  <div className="col-span-2">
                    <PushNotificationToggle variant="tile" profileId={profileId} />
                  </div>
                </div>
              )}
              {view === "clients" && (
                <div className="h-full overflow-y-auto p-4">
                  <SpotClientsGroupsPanel key={activeGroupId} groupId={activeGroupId} onNavigated={close} fromHub />
                </div>
              )}
              {view === "business" && (
                <div className="h-full overflow-y-auto p-4">
                  <BusinessMiniDashboard key={activeGroupId} groupId={activeGroupId} expanded />
                </div>
              )}
              {view === "calendar" && (
                <div className="h-full overflow-y-auto p-4">
                  <CalendarMiniView key={activeGroupId} groupId={activeGroupId} />
                </div>
              )}
              {view === "program" && (
                <div className="h-full overflow-y-auto p-4">
                  {builderOpen ? (
                    <SpotBuilderPanel
                      key={activeGroupId}
                      groupId={activeGroupId}
                      initialAthleteId={initialAthleteId}
                      initialAthleteName={initialAthleteName}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setBuilderOpen(true)}
                        className="w-full h-11 mb-4 bg-rust text-graphite font-body text-sm font-medium flex items-center justify-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        Build a program with AI
                      </button>
                      <ProgramMiniView key={activeGroupId} groupId={activeGroupId} />
                    </>
                  )}
                </div>
              )}
              {view === "ask-spot" && (
                <div className="h-full flex flex-col">
                  <AskSpotChatPanel />
                </div>
              )}
              {view === "quick-payment" && (
                <div className="h-full overflow-y-auto">
                  <QuickPaymentPanel key={activeGroupId} groupId={activeGroupId} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
