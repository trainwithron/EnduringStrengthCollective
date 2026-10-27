"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Dumbbell, Mail, MessageCircle, Sparkles, TrendingUp, Users, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { SpotNeedsTop } from "./spot-needs-top";
import { SPOT_LAST_OPENED_KEY, SPOT_NEEDS_CACHE_KEY, readSpotNeedsCache, shouldFade, spotCount, spotNeedsCacheEntry, type SpotNeeds } from "@/lib/spot-needs";
import { isEmbeddedWindow } from "@/components/ui/loading-watchdog";
import { PushNotificationToggle } from "@/components/athlete/push-notification-toggle";
import { createBrowserClient } from "@/lib/supabase/client";
import { useTerm } from "@/components/coach/terminology-provider";
import { getCoachedGroups, LAST_WORKSPACE_GROUP_COOKIE } from "@/lib/coach-groups";
import { ACTIVE_ORG_COOKIE, readBrowserCookie, rememberedGroupForActiveOrg } from "@/lib/active-org";
import { hubOrgs, hubStartGroup, hubStartOrgId, pageOrgId, type HubOrg } from "@/lib/hub-orgs";
import { isTeamSportGroup, orgIsTeamOnly, TEAM_SPORT_HIDDEN_HUB_TILES } from "@/lib/team-sport";
import { isPhoneView } from "@/lib/phone-coach-routes";
import { VIEW_OVERRIDE_COOKIE } from "@/lib/pwa";
import type { CoachedGroup } from "@/lib/coach-groups";

// The panels behind the tiles (and the Program tile's templates) are loaded only when one is opened (every phone page carries this hub; most never open a panel). What needs you (SpotNeedsTop) stays in the page.
const BusinessMiniDashboard = dynamic(() => import("@/components/coach/desktop/business-mini-dashboard").then((m) => m.BusinessMiniDashboard), { ssr: false, loading: () => null });
const AskSpotChatPanel = dynamic(() => import("@/components/coach/ask-spot-chat-panel").then((m) => m.AskSpotChatPanel), { ssr: false, loading: () => null });
const QuickPaymentPanel = dynamic(() => import("./quick-payment-panel").then((m) => m.QuickPaymentPanel), { ssr: false, loading: () => null });
const SpotBuilderPanel = dynamic(() => import("./spot-builder-panel").then((m) => m.SpotBuilderPanel), { ssr: false, loading: () => null });
const SpotClientsGroupsPanel = dynamic(() => import("./spot-clients-groups-panel").then((m) => m.SpotClientsGroupsPanel), { ssr: false, loading: () => null });
const SpotMessagesPanel = dynamic(() => import("./spot-messages-panel").then((m) => m.SpotMessagesPanel), { ssr: false, loading: () => null });
const SpotTemplates = dynamic(() => import("./spot-templates").then((m) => m.SpotTemplates), { ssr: false, loading: () => null });

type TileKey = "clients" | "messages" | "business" | "program" | "ask-spot";

export const SPOT_OPEN_HASHES = ["late-changes", "schedule-requests", "expiring"] as const;

// Ron, Oct 19: "I already have a calendar button. That doesn't need to be there. Quick payment could probably be rolled into business." "I do want messages in the spotlight tab."
export const TILES: { key: TileKey; label: string; icon: typeof Users }[] = [
  { key: "clients", label: "Clients", icon: Users },
  { key: "messages", label: "Messages", icon: Mail },
  { key: "business", label: "Business", icon: TrendingUp },
  { key: "program", label: "Program", icon: Dumbbell },
  { key: "ask-spot", label: "Ask Spot", icon: MessageCircle },
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
  homeHref,
  compact = false,
}: {
  groupId: string;
  // Deep link from a client's own row/profile (?spotBuilder=...): opens
  // straight into Program -> Build with AI for that client.
  initialAthleteId?: string | null;
  initialAthleteName?: string | null;
  // When set (the slim Coach mode bar while logging), the hub's grid starts with a Home link, so the bar needs no Home button of its own.
  homeHref?: string;
  // A smaller sparkle that fits the slim bar.
  compact?: boolean;
}) {
  const [open, setOpen] = useState(!!initialAthleteId);
  const [view, setView] = useState<"grid" | TileKey>(initialAthleteId ? "program" : "grid");
  const [builderOpen, setBuilderOpen] = useState(!!initialAthleteId);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  // The group every tile acts on. A coach who runs more than one organization chooses the organization in the header; the tiles then use that organization's group.
  const [activeGroupId, setActiveGroupId] = useState(groupId);
  // What needs the coach first (lib/spot-needs.ts): read when the page opens and every time Spotlight opens. It fills the top of the drop-down and the dot on the button.
  const [needs, setNeeds] = useState<SpotNeeds | null>(null);
  const [fade, setFade] = useState(false);
  const needsRequest = useRef(0);
  function showNeeds(data: SpotNeeds) {
    setNeeds(data);
    let lastOpened: string | null = null;
    try {
      lastOpened = window.localStorage.getItem(SPOT_LAST_OPENED_KEY);
    } catch {
      // no memory of the last open: anything counts as new
    }
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setFade(shouldFade(data.newestAt, lastOpened, reduced));
  }
  function loadNeeds(opening: boolean) {
    const org = readBrowserCookie(ACTIVE_ORG_COOKIE);
    // A page opened within a minute of the last read uses that answer (opening Spotlight always reads it fresh).
    if (!opening) {
      let kept: SpotNeeds | null = null;
      try {
        kept = readSpotNeedsCache(window.sessionStorage.getItem(SPOT_NEEDS_CACHE_KEY), org, Date.now());
      } catch {
        // no storage: read it
      }
      if (kept) {
        showNeeds(kept);
        return;
      }
    }
    const request = ++needsRequest.current;
    fetch("/api/coach/spot-needs")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SpotNeeds | null) => {
        if (!data || request !== needsRequest.current) return;
        try {
          window.sessionStorage.setItem(SPOT_NEEDS_CACHE_KEY, spotNeedsCacheEntry(data, org, Date.now()));
        } catch {
          // not kept: the next page reads it again
        }
        if (opening) {
          setNeeds(data);
          return;
        }
        showNeeds(data);
      })
      .catch(() => {
        // the button simply shows no dot
      });
  }
  useEffect(() => {
    // Never inside an embedded frame (the split half, a workspace pane): the page holding it has its own Spotlight.
    if (isEmbeddedWindow()) return;
    // Opened by a link (Release 2): ?spot=1 (a coach page that lives in Spotlight on a phone), or a notice naming a panel (#late-changes, #schedule-requests, #expiring).
    const anchor = SPOT_OPEN_HASHES.find((h) => window.location.hash === `#${h}`) ?? null;
    if (new URLSearchParams(window.location.search).get("spot") === "1" || anchor) {
      setOpen(true);
      setView("grid");
      loadNeeds(true);
      if (anchor) {
        // the panel reads its own rows; look for it for a few seconds
        let tries = 0;
        const timer = window.setInterval(() => {
          const el = document.querySelector(`[data-spot-anchor="${anchor}"] section`);
          if (el || ++tries > 20) {
            window.clearInterval(timer);
            el?.scrollIntoView({ block: "start" });
          }
        }, 250);
      }
      return;
    }
    // Only where the button is actually on screen (on a computer it is mounted but hidden), and never for a hidden tab: an idle open page must not keep asking (Oct 20 outage).
    // Opening Spotlight always reads it.
    if (document.visibilityState !== "visible" || !triggerRef.current || triggerRef.current.getClientRects().length === 0) return;
    loadNeeds(false);
  }, []);
  // A team-sport group has no Business tile (lib/team-sport.ts). Unknown until read, which shows every tile.
  const [teamSport, setTeamSport] = useState(false);
  useEffect(() => {
    let cancelled = false;
    createBrowserClient()
      .from("groups")
      .select("team_mode")
      .eq("id", activeGroupId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setTeamSport(isTeamSportGroup((data as { team_mode?: boolean | null } | null)?.team_mode));
      });
    return () => {
      cancelled = true;
    };
  }, [activeGroupId]);
  const [orgs, setOrgs] = useState<HubOrg[]>([]);
  // Several organizations, none chosen, and the page belongs to none (the coach's own space): the tiles ask which organization instead of acting on the wrong one.
  const [needsOrg, setNeedsOrg] = useState(false);
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  // The organization the PAGE belongs to (null on the coach's own space). Choosing another organization in the hub leaves this page for that organization's Home.
  const pageOrg = useRef<string | null>(null);
  // The coach's groups (read with the organizations), so choosing a team organization on the phone can open its team Home.
  const coachedGroups = useRef<CoachedGroup[]>([]);
  const orgsRequested = useRef(false);
  // A platform admin's own tools (Support inbox, Organizations) sit under Business (Release 2: they used to be in the More list).
  const [platformAdmin, setPlatformAdmin] = useState(false);
  useEffect(() => {
    // Only needed for the notification tile's test message, and the admin links.
    const supabase = createBrowserClient();
    supabase.auth.getUser().then(async ({ data }) => {
      setProfileId(data.user?.id);
      if (!data.user) return;
      const { data: me } = await supabase.from("profiles").select("is_platform_admin").eq("id", data.user.id).maybeSingle();
      setPlatformAdmin((me as { is_platform_admin?: boolean } | null)?.is_platform_admin === true);
    });
  }, []);
  useEffect(() => {
    // Which organizations this coach has: read the first time the hub is opened (the dropdown is only visible then), not on every page.
    if (!open || orgsRequested.current) return;
    orgsRequested.current = true;
    // Not cancelled when the hub is closed again: the read finishes and fills the dropdown for the next open. If it fails, the next open tries again.
    (async () => {
      try {
        const supabase = createBrowserClient();
        const { data } = await supabase.auth.getUser();
        if (!data.user) {
          orgsRequested.current = false;
          return;
        }
        const groups = await getCoachedGroups(supabase, data.user.id);
        coachedGroups.current = groups;
        // The organization is the one the coach CHOSE (its own cookie); the last group opened only picks a group inside it.
        const rememberedId = rememberedGroupForActiveOrg(groups, readBrowserCookie(ACTIVE_ORG_COOKIE), readBrowserCookie(LAST_WORKSPACE_GROUP_COOKIE));
        const list = hubOrgs(groups, rememberedId);
        const start = hubStartOrgId(groups, rememberedId, groupId);
        pageOrg.current = pageOrgId(groups, groupId);
        setOrgs(list);
        setOrgId(start);
        // Starts on the organization Home is showing (the one chosen with the organization switcher), except when the hub was opened for one particular client. On the coach's own space (no organization) it
        // starts on the chosen or only organization, never on the space itself.
        if (!initialAthleteId) {
          const startGroup = hubStartGroup(groups, rememberedId, groupId);
          if (startGroup.needsChoice) setNeedsOrg(true);
          else if (startGroup.groupId) setActiveGroupId(startGroup.groupId);
        }
      } catch {
        // the hub keeps working on the page's own group; the next open tries again
        orgsRequested.current = false;
      }
    })();
  }, [open, groupId, initialAthleteId]);

  function chooseOrg(nextOrgId: string) {
    const next = orgs.find((o) => o.orgId === nextOrgId);
    if (!next) return;
    setOrgId(next.orgId);
    setNeedsOrg(false);
    setActiveGroupId(next.anchorGroupId);
    setBuilderOpen(false);
    // The page being viewed belongs to one organization, and every request it makes names that page's group; the database refuses another organization's rows to such a request. So the tiles of ANOTHER
    // organization read blank (no program, no bookings, zeros) while this page stays open. Choosing another organization therefore closes the hub and goes to that organization's Home.
    const leavesPage = pageOrg.current !== next.orgId;
    try {
      // The same memory the organization switcher keeps, so Home follows the hub.
      document.cookie = `${LAST_WORKSPACE_GROUP_COOKIE}=${encodeURIComponent(next.anchorGroupId)}; path=/; max-age=${60 * 60 * 24 * 90}`;
      document.cookie = `${ACTIVE_ORG_COOKIE}=${encodeURIComponent(next.orgId)}; path=/; max-age=${60 * 60 * 24 * 90}`;
    } catch {
      // not remembered; the hub still switched
    }
    // On the coach's own space (it belongs to no organization) the page stays: it reloads, and every tile then reads the organization just chosen (Release 2). On a phone a TEAM organization opens its team
    // Home instead (Oct 21: choosing the Trojans only reloaded the coach's own Home, so their team's programs could not be seen).
    if (leavesPage && pageOrg.current === null) {
      const inOrg = coachedGroups.current.filter((g) => g.orgId === next.orgId).map((g) => g.id);
      const phone = isPhoneView({ override: readBrowserCookie(VIEW_OVERRIDE_COOKIE), userAgent: navigator.userAgent });
      if (!phone || inOrg.length === 0) {
        window.location.reload();
        return;
      }
      void (async () => {
        let teamHome: string | null = null;
        try {
          const { data, error } = await createBrowserClient().from("groups").select("id, team_mode").in("id", inOrg);
          if (!error && (data ?? []).length === inOrg.length && orgIsTeamOnly((data ?? []) as { team_mode: boolean | null }[])) teamHome = `/groups/${next.anchorGroupId}`;
        } catch {
          // not known: the page reloads as before
        }
        if (teamHome) window.location.assign(teamHome);
        else window.location.reload();
      })();
      return;
    }
    if (leavesPage) {
      // A full page load, not a client-side navigation: the soft navigation after the switch hung on a loading skeleton in the live check (Oct 19), and a full load also brings the new organization's colors,
      // fonts and icon. The chosen organization is already in the cookies.
      window.location.assign("/dashboard");
      return;
    }
    router.refresh(); // the colors, fonts and icon follow the organization chosen
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
      setFade(false);
      try {
        window.localStorage.setItem(SPOT_LAST_OPENED_KEY, new Date().toISOString());
      } catch {
        // not remembered; the next new thing fades again
      }
      loadNeeds(true);
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
  const title = activeTile ? (view === "program" && builderOpen ? "Build a program" : labelOf(activeTile)) : "Spotlight";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        // The name stays exactly "Spotlight" (the install banner finds the button by it); the count is its description.
        aria-label="Spotlight"
        aria-describedby={needs && needs.count > 0 ? `${panelId}-count` : undefined}
        className={`fixed left-1/2 -translate-x-1/2 z-40 rounded-token-circle bg-graphite/90 border border-rust/50 flex items-center justify-center active:border-rust transition-colors shadow-lg ${
          compact ? "top-[calc(env(safe-area-inset-top)+1px)] h-[30px] w-[30px]" : "top-3 h-10 w-10"
        }`}
      >
        <Sparkles className={compact ? "w-4 h-4 text-rust" : "w-5 h-5 text-rust"} strokeWidth={2.25} />
        {needs && needs.count > 0 && (
          <>
            <span
              data-spot-dot
              aria-hidden="true"
              className={`absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-rust text-graphite font-body text-[10px] font-bold leading-4 text-center ${fade ? "spot-dot-fade" : ""}`}
            >
              {needs.count > 9 ? "9+" : needs.count}
            </span>
            <span id={`${panelId}-count`} className="sr-only">
              {needs.count} waiting
            </span>
          </>
        )}
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
                  {orgId === null && (
                    <option value="" disabled>
                      Choose an organization
                    </option>
                  )}
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
                <div className="h-full overflow-y-auto grid grid-cols-2 gap-2 p-4 content-start">
                  {needs && !needs.needsChoice && (
                    <SpotNeedsTop
                      needs={needs}
                      onNavigated={close}
                      onNoticesCleared={() => {
                        const cleared = { ...needs, notices: [] };
                        // the dot and the remembered answer follow at once
                        showNeeds({ ...cleared, count: spotCount(cleared) });
                        try {
                          window.sessionStorage.removeItem(SPOT_NEEDS_CACHE_KEY);
                        } catch {
                          // nothing remembered; the next read is fresh anyway
                        }
                      }}
                    />
                  )}
                  {homeHref && (
                    <a
                      href={homeHref}
                      className="col-span-2 border border-steel/20 p-3 flex items-center justify-center gap-2 active:border-rust active:bg-rust/5 transition-colors"
                    >
                      <span className="font-body text-sm text-chalk text-center">Home</span>
                    </a>
                  )}
                  {TILES.filter((tile) => !(teamSport && TEAM_SPORT_HIDDEN_HUB_TILES.includes(tile.key))).map((tile) => {
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
                  {/* How everything works: the help center, one tap from the coaching button. */}
                  <Link
                    href="/help"
                    onClick={close}
                    data-how-it-works
                    className="col-span-2 min-h-11 border border-steel/20 p-3 flex items-center justify-center gap-2 active:border-rust active:bg-rust/5 transition-colors"
                  >
                    <span className="font-body text-sm text-chalk text-center">How it works</span>
                  </Link>
                  {/* Shows only while notifications are off and could be turned on. */}
                  <div className="col-span-2">
                    <PushNotificationToggle variant="tile" profileId={profileId} />
                  </div>
                </div>
              )}
              {needsOrg && ["clients", "messages", "business", "program"].includes(view) && (
                <div className="h-full overflow-y-auto p-4">
                  <p className="font-body text-sm text-chalk">Which organization are you working in?</p>
                  <p className="font-body text-xs text-steel mt-1">Choose it at the top of this panel. Until then this would show your own space, not the organization.</p>
                </div>
              )}
              {view === "clients" && !needsOrg && (
                <div className="h-full overflow-y-auto p-4">
                  <SpotClientsGroupsPanel key={activeGroupId} groupId={activeGroupId} onNavigated={close} fromHub />
                </div>
              )}
              {view === "messages" && !needsOrg && (
                <div className="h-full overflow-y-auto p-4">
                  <SpotMessagesPanel key={activeGroupId} groupId={activeGroupId} onNavigated={close} />
                </div>
              )}
              {view === "business" && !needsOrg && (
                <div className="h-full overflow-y-auto p-4 space-y-4">
                  <BusinessMiniDashboard key={activeGroupId} groupId={activeGroupId} expanded />
                  {/* Quick payment lives inside Business (Ron: "Quick payment could probably be rolled into business"). */}
                  <div className="border-t border-steel/20 -mx-4">
                    <p className="px-4 pt-4 font-body text-xs text-steel uppercase tracking-wide font-bold">Quick payment</p>
                    <QuickPaymentPanel key={activeGroupId} groupId={activeGroupId} />
                  </div>
                  {/* The organization's own settings (colors, team, plan live on its pages) and, for a platform admin, their tools: they used to be in the phone's More list. */}
                  <div className="border-t border-steel/20 pt-3 space-y-1" data-business-links>
                    <a href={`/groups/${activeGroupId}/settings`} className="block min-h-11 leading-[2.75rem] font-body text-sm text-rust">
                      Organization settings →
                    </a>
                    {platformAdmin && (
                      <>
                        <a href="/admin/support" className="block min-h-11 leading-[2.75rem] font-body text-sm text-chalk">
                          Support inbox →
                        </a>
                        <a href="/admin/organizations" className="block min-h-11 leading-[2.75rem] font-body text-sm text-chalk">
                          Organizations →
                        </a>
                      </>
                    )}
                  </div>
                </div>
              )}
              {view === "program" && !needsOrg && (
                <div className="h-full overflow-y-auto p-4">
                  {/* Release 3: ONE box (describe it for the AI, paste one, or attach a file or photo), full screen, and the way to every program. */}
                  {builderOpen ? (
                    <SpotBuilderPanel
                      key={activeGroupId}
                      groupId={activeGroupId}
                      initialAthleteId={initialAthleteId}
                      initialAthleteName={initialAthleteName}
                      onClose={() => setBuilderOpen(false)}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setBuilderOpen(true)}
                        className="w-full h-11 mb-2 bg-rust text-graphite font-body text-sm font-medium flex items-center justify-center gap-2"
                        data-open-program-box
                      >
                        <Sparkles className="w-4 h-4" />
                        Build a program
                      </button>
                      <p className="font-body text-xs text-steel mb-4">Describe it, paste one, or attach a file or photo. You check it before anything is made.</p>
                      <a href="/programs" className="block min-h-11 leading-[2.75rem] mb-2 font-body text-sm text-rust" data-all-programs>
                        All programs →
                      </a>
                      {/* Use a template (built on a computer): its slots filled from the ladders, tailored with Easier / Harder. */}
                      <SpotTemplates key={activeGroupId} groupId={activeGroupId} />
                    </>
                  )}
                </div>
              )}
              {view === "ask-spot" && (
                <div className="h-full flex flex-col">
                  <AskSpotChatPanel />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
