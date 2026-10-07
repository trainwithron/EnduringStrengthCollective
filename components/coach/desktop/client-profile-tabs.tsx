"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CLIENT_PROFILE_TABS, type ClientProfileTab } from "@/lib/client-profile-tabs";

// The strip across the top of one client's profile (Ron, Oct 6: "I want my Facebook page, but if I'm on their profile I see what's about them"). It sits in the
// normal coach layout, beside the coach's own rail, which never changes. Overview, Programs, Nutrition, Progress, Forms & notes and Billing & settings switch what
// is shown on this page (everything is already loaded, so it is instant, and the tab is remembered in the address); Messages and Calendar open those screens for
// this client.
export function ClientProfileTabs({ groupId, athleteId, initial = "overview" }: { groupId: string; athleteId: string; initial?: ClientProfileTab }) {
  const [tab, setTab] = useState<ClientProfileTab>(initial);

  // Show only the sections of the chosen tab: the page's body carries data-active-tab and each section carries data-tab (see globals.css).
  useEffect(() => {
    const body = document.getElementById("client-profile-body");
    if (body) body.setAttribute("data-active-tab", tab);
  }, [tab]);

  function choose(next: ClientProfileTab) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url.toString());
    } catch {
      // The tab still switches; it just is not remembered in the address.
    }
  }

  const base = "h-10 px-3 font-body text-[13px] border-b-2 -mb-px whitespace-nowrap";
  const inPage = (t: { key: ClientProfileTab; label: string }) => (
    <button key={t.key} type="button" onClick={() => choose(t.key)} aria-current={tab === t.key ? "page" : undefined} className={`${base} ${tab === t.key ? "border-rust text-chalk" : "border-transparent text-steel hover:text-chalk"}`}>
      {t.label}
    </button>
  );
  const link = (href: string, label: string) => (
    <Link href={href} className={`${base} border-transparent text-steel hover:text-chalk inline-flex items-center`}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="This client" className="flex items-end gap-1 overflow-x-auto border-b border-steel/20 mb-6">
      {CLIENT_PROFILE_TABS.slice(0, 1).map(inPage)}
      {link(`/groups/${groupId}/messages/${athleteId}`, "Messages")}
      {CLIENT_PROFILE_TABS.slice(1, 3).map(inPage)}
      {link(`/groups/${groupId}/athletes/${athleteId}/calendar`, "Calendar")}
      {CLIENT_PROFILE_TABS.slice(3).map(inPage)}
    </nav>
  );
}
