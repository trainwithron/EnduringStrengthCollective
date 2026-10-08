"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CLIENT_PROFILE_TABS, LOADED_ON_OPEN, type ClientProfileTab } from "@/lib/client-profile-tabs";

// The strip across the top of one client's profile (Ron, Oct 6: "I want my Facebook page, but if I'm on their profile I see what's about them"). It sits in the
// normal coach layout, beside the coach's own rail, which never changes. Every tab shows its content right below the strip, on this page. Overview, Programs, Nutrition,
// Progress, Forms & notes and Billing & settings are already loaded, so they switch instantly; Messages and Calendar are loaded when opened (the address gets ?tab=...,
// so a link, a reload or the phone's full pages still work). The tab is remembered in the address. The strip wraps instead of scrolling.
export function ClientProfileTabs({ initial = "overview" }: { groupId?: string; athleteId?: string; initial?: ClientProfileTab }) {
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
    if (LOADED_ON_OPEN.includes(next)) {
      // Not on the page yet: ask for it. The strip changes at once; the content follows as soon as it is loaded.
      setTab(next);
      startTransition(() => router.push(`${pathname}?tab=${next}`, { scroll: false }));
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

  const base = "h-11 px-3 font-body text-[13px] border-b-2 -mb-px whitespace-nowrap";
  return (
    <nav aria-label="This client" aria-busy={pending} className="flex flex-wrap items-end gap-x-1 border-b border-steel/20 mb-6">
      {CLIENT_PROFILE_TABS.map((t) => (
        <button key={t.key} type="button" onClick={() => choose(t.key)} aria-pressed={tab === t.key} className={`${base} ${tab === t.key ? "border-rust text-chalk" : "border-transparent text-steel hover:text-chalk"}`}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
