"use client";

import { useState } from "react";
import { PushNotificationToggle } from "@/components/athlete/push-notification-toggle";
import { PushPreferences } from "@/components/athlete/push-preferences";
import { NoticeSwitches } from "@/components/coach/notice-switches";
import { NOTICE_KINDS } from "@/lib/coach-notice-kinds";

/** "Push notifications · 6 of 9 on" for a coach with the switches; "Push notifications" otherwise. */
export function notificationsSummary(off: string[] | null): string {
  if (off === null) return "Push notifications";
  const on = NOTICE_KINDS.filter((k) => !off.includes(k.id)).length;
  return `Push notifications · ${on} of ${NOTICE_KINDS.length} on`;
}

// Settings > Notifications (Ron, Oct 21: "Needs to be collapsible. That's way too big."): one row, closed until tapped, that opens in place to this device's push switch, quiet hours and,
// for a coach, the switch per kind of notice. The row's count follows the switches as they are tapped. The same on a computer and a phone.
export function NotificationSettings({
  profileId,
  audience,
  pushPrefs,
  notices,
}: {
  profileId: string;
  audience: "coach" | "client";
  pushPrefs: { quiet_hours_start: number | null; quiet_hours_end: number | null; generic_push_text: boolean | null } | null;
  /** The kinds a coach turned off; null when the switches are not shown (a client, someone else's view, or not readable). */
  notices: { initialOff: string[] } | null;
}) {
  const [off, setOff] = useState<string[] | null>(notices ? notices.initialOff : null);
  return (
    <details className="border border-steel/20" data-notification-settings>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 min-h-[44px] px-4">
        <span className="font-body text-sm text-chalk">{notificationsSummary(off)}</span>
        <span className="font-body text-xs text-steel" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4 pt-3 border-t border-steel/15">
        <PushNotificationToggle variant="settings" profileId={profileId} audience={audience} />
        <PushPreferences profileId={profileId} initialStart={pushPrefs?.quiet_hours_start ?? null} initialEnd={pushPrefs?.quiet_hours_end ?? null} initialGeneric={pushPrefs?.generic_push_text === true} available={!!pushPrefs} />
        {notices && <NoticeSwitches profileId={profileId} initialOff={notices.initialOff} available onOffChange={setOff} />}
      </div>
    </details>
  );
}
