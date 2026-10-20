import Link from "next/link";
import { foodDayHref, foodDaySwitcher } from "@/lib/food-day";

// "‹ Yesterday · Today · Tomorrow ›" at the top of Today's food (Ron, Oct 20). Plain text links, 44 px tall; the day goes in the address, so the same section re-renders for it.
// Up to a week back and a week ahead; past that edge the arrow is not shown. The middle is the day shown; when it is not today, tapping it goes back to today.
export function FoodDaySwitcher({ groupId, shownKey, todayKey }: { groupId: string; shownKey: string; todayKey: string }) {
  const s = foodDaySwitcher(shownKey, todayKey);
  const link = "min-h-[44px] px-2 inline-flex items-center font-body text-sm text-steel active:text-rust";
  return (
    <nav aria-label="Day" className="flex items-center justify-between gap-2 mb-2" data-testid="food-day-switcher">
      {s.prev ? (
        <Link href={foodDayHref(groupId, s.prev.key, todayKey)} scroll={false} className={link} aria-label={`Show ${s.prev.label}`}>
          ‹ {s.prev.label}
        </Link>
      ) : (
        <span className="min-w-[44px]" aria-hidden="true" />
      )}
      {s.isToday ? (
        <span className="min-h-[44px] px-2 inline-flex items-center font-body text-sm font-medium text-chalk" aria-current="date">
          {s.current}
        </span>
      ) : (
        <Link href={foodDayHref(groupId, todayKey, todayKey)} scroll={false} className="min-h-[44px] px-2 inline-flex items-center font-body text-sm font-medium text-chalk" aria-label={`${s.current}: back to today`}>
          {s.current}
        </Link>
      )}
      {s.next ? (
        <Link href={foodDayHref(groupId, s.next.key, todayKey)} scroll={false} className={link} aria-label={`Show ${s.next.label}`}>
          {s.next.label} ›
        </Link>
      ) : (
        <span className="min-w-[44px]" aria-hidden="true" />
      )}
    </nav>
  );
}
