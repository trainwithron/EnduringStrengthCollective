import Link from "next/link";
import { CAUGHT_UP, COULD_NOT_CHECK, moreLabel, type NeedsYouView } from "@/lib/needs-you";

// "Needs you": at most three things at the top of Home, one per slot (someone is waiting on you, something is due soon, someone may need a check-in), each the single most urgent of its
// kind. A slot with nothing shows nothing. When nothing needs the coach it says so. "N more" jumps to the stack of panels below, which is unchanged.
export function NeedsYouStrip({ view }: { view: NeedsYouView }) {
  const filled = view.slots.filter((s) => s.item);
  return (
    <section className="mb-6" aria-label="Needs you">
      {view.caughtUp ? (
        <p className="font-body text-sm text-chalk border border-steel/20 p-4" role="status">
          {CAUGHT_UP}
        </p>
      ) : filled.length === 0 ? (
        <p className="font-body text-sm text-chalk border border-steel/20 p-4" role="status">
          {COULD_NOT_CHECK}
        </p>
      ) : (
        <div className="space-y-2">
          <ul className="grid gap-2 lg:grid-cols-3">
            {filled.map(({ slot, title, item }) => (
              <li key={slot} className="border border-rust/40 p-3 flex flex-col gap-2" data-testid={`needs-you-${slot}`}>
                <p className="font-display uppercase text-xs tracking-wide text-steel">{title}</p>
                <p className="font-body text-sm text-chalk">
                  {item!.profileHref ? (
                    <Link href={item!.profileHref} className="font-medium underline-offset-2 hover:underline">
                      {item!.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{item!.name}</span>
                  )}{" "}
                  {item!.sentence}
                </p>
                <Link href={item!.href} className="mt-auto inline-flex items-center justify-center h-11 px-5 bg-rust text-graphite font-body text-sm font-medium self-start">
                  {item!.button}
                </Link>
              </li>
            ))}
          </ul>
          {view.incomplete && (
            <p className="font-body text-xs text-steel" role="status">
              {COULD_NOT_CHECK}
            </p>
          )}
          {view.moreCount > 0 && (
            <Link href="#needs-stack" className="inline-block font-body text-sm text-steel hover:text-chalk underline underline-offset-2 min-h-11 leading-[2.75rem]">
              {moreLabel(view.moreCount)}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
