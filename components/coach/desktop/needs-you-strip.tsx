import Link from "next/link";
import { CAUGHT_UP, COULD_NOT_CHECK, type NeedsYouSlot, type NeedsYouView } from "@/lib/needs-you";
import { QuietClientNudgeButton } from "@/components/coach/quiet-client-nudge-button";
import { NeedsYouMore, NeedsYouSendLink } from "@/components/coach/desktop/needs-you-more";

// Each kind on a card tinted by what it is about (Look Refresh, Nov 20): someone waiting on the coach in coral, something due in the accent, a check-in in blue.
const SLOT_LOOK: Record<NeedsYouSlot, { card: string; title: string }> = {
  waiting: { card: "tint-alert", title: "text-alert" },
  due: { card: "tint-accent", title: "text-rust-ink" },
  slipping: { card: "tint-checkin", title: "text-checkin" },
};

// "Needs you": at most three things at the top of Home, one per slot (someone is waiting on you, something is due soon, someone may need a check-in), each the single most urgent of its
// kind. A slot with nothing shows nothing. When nothing needs the coach it says so. "N more" opens the rest of the ranked list in place, each with its own button (audit, Nov 21).
export function NeedsYouStrip({ view, viewer = null }: { view: NeedsYouView; viewer?: { id: string; name: string } | null }) {
  const filled = view.slots.filter((s) => s.item);
  return (
    <section className="mb-6" aria-label="Needs you">
      {view.caughtUp ? (
        <p className="font-body text-sm text-chalk bg-surface rounded-card p-4" role="status">
          {CAUGHT_UP}
        </p>
      ) : filled.length === 0 ? (
        <p className="font-body text-sm text-chalk bg-surface rounded-card p-4" role="status">
          {COULD_NOT_CHECK}
        </p>
      ) : (
        <div className="space-y-2">
          <ul className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {filled.map(({ slot, title, item }) => (
              <li key={slot} className={`${SLOT_LOOK[slot].card} rounded-card p-4 flex flex-col gap-2`} data-testid={`needs-you-${slot}`}>
                <p className={`font-body text-[13px] font-semibold ${SLOT_LOOK[slot].title}`}>{title}</p>
                <p className="font-body text-sm text-chalk">
                  {item!.profileHref ? (
                    <Link prefetch={false} href={item!.profileHref} className="font-medium underline-offset-2 hover:underline">
                      {item!.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{item!.name}</span>
                  )}{" "}
                  {item!.sentence}
                </p>
                {item!.nudge && viewer ? (
                  // "Message {name}" sends inside Spotlight from here (R1's send), the draft editable first (R3: quiet in chat)
                  <div className="mt-auto">
                    <QuietClientNudgeButton athleteId={item!.nudge.athleteId} athleteFirstName={item!.nudge.firstName} groupId={item!.nudge.groupId} coachId={viewer.id} coachName={viewer.name} />
                  </div>
                ) : item!.claimLink ? (
                  // "Send link" emails the sign-in link from here (the profile's same send and confirm), with Sign-in options beside it
                  <NeedsYouSendLink groupId={item!.claimLink.groupId} athleteId={item!.claimLink.athleteId} optionsHref={item!.href} />
                ) : (
                  <Link prefetch={false} href={item!.href} className="mt-auto inline-flex items-center justify-center h-11 px-5 bg-rust text-graphite font-body text-sm font-medium self-start">
                    {item!.button}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {view.incomplete && (
            <p className="font-body text-xs text-steel" role="status">
              {COULD_NOT_CHECK}
            </p>
          )}
          {view.moreCount > 0 && <NeedsYouMore items={view.more} viewer={viewer} />}
        </div>
      )}
    </section>
  );
}
