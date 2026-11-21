"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CLIENT_PROFILE_TABS, LOADED_ON_OPEN, type ClientProfileTab } from "@/lib/client-profile-tabs";
import { OPEN_CLIENT_MESSAGES_EVENT } from "@/lib/open-client-messages";

// The strip across the top of one client's profile (Ron, Oct 6: "I want my Facebook page, but if I'm on their profile I see what's about them"). It sits in the
// normal coach layout, beside the coach's own rail, which never changes. Every tab shows its content right below the strip, on this page. Overview, Programs, Nutrition,
// Progress, Forms & notes and Billing & settings are already loaded, so they switch instantly; Messages and Calendar are loaded when opened (the address gets ?tab=...,
// so a link, a reload or the phone's full pages still work). The tab is remembered in the address, replacing the entry (a tab is not a step back: the profile's "Back" and the
// phone's back go where the coach came from). On a computer the strip wraps; on a phone it is one line that scrolls sideways.
export function ClientProfileTabs({ groupId, athleteId, initial = "overview", hide = [] }: { groupId?: string; athleteId?: string; initial?: ClientProfileTab; hide?: ClientProfileTab[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<ClientProfileTab>(initial);
  const [pending, startTransition] = useTransition();

  // The page sends the tab the address names (a link, a reload, or a month change inside Calendar): follow it.
  useEffect(() => {
    setTab(initial);
  }, [initial]);

  // Show only the sections of the chosen tab: the page's body carries data-active-tab and each section carries data-tab (see globals.css).
  useEffect(() => {
    const body = document.getElementById("client-profile-body");
    if (body) body.setAttribute("data-active-tab", tab);
  }, [tab]);

  function choose(next: ClientProfileTab) {
    if (next === tab) return;
    if (LOADED_ON_OPEN.includes(next) || LOADED_ON_OPEN.includes(tab)) {
      // Opening Messages or Calendar: it is not on the page yet, so ask for it. LEAVING one: go by address too, so the page stops rendering it. A hidden Messages thread would stay
      // mounted and keep marking what the client sends as read while the coach looks at another tab, and the unread badge would never show it.
      // The strip changes at once; the content follows as soon as it is loaded.
      setTab(next);
      startTransition(() => router.replace(next === "overview" ? pathname : `${pathname}?tab=${next}`, { scroll: false }));
      return;
    }
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      url.searchParams.delete("month");
      window.history.replaceState(null, "", url.toString());
    } catch {
      // The tab still switches; it just is not remembered in the address.
    }
  }

  // The header's Message button (lib/open-client-messages.ts): go to Overview, where the message box opens. The box listens for the same event.
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    const onOpenMessages = () => chooseRef.current("overview");
    window.addEventListener(OPEN_CLIENT_MESSAGES_EVENT, onOpenMessages);
    return () => window.removeEventListener(OPEN_CLIENT_MESSAGES_EVENT, onOpenMessages);
  }, []);

  // On a phone the strip is one line that scrolls sideways (clutter pass, Nov 21: seven tabs wrapped onto about three rows); the chosen tab is scrolled into view.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (nav && active && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = Math.max(0, active.offsetLeft - nav.offsetLeft - 16);
  }, [tab]);

  const base = "h-11 px-3 font-body text-[13px] border-b-2 lg:-mb-px whitespace-nowrap shrink-0";
  return (
    <nav ref={navRef} aria-label="This client" aria-busy={pending} className="flex flex-nowrap overflow-x-auto [scrollbar-width:none] lg:flex-wrap lg:overflow-x-visible items-end gap-x-1 border-b border-steel/20 mb-6" data-profile-tab-strip>
      {CLIENT_PROFILE_TABS.filter((t) => !hide.includes(t.key)).map((t) => (
        <button key={t.key} type="button" onClick={() => choose(t.key)} aria-pressed={tab === t.key} className={`${base} ${tab === t.key ? "border-rust text-chalk" : "border-transparent text-steel hover:text-chalk"}`}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
