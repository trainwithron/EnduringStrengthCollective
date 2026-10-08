import type { ReactNode } from "react";
import { SpotlightLockup } from "@/components/brand/spotlight-mark";
import { RefreshCw } from "lucide-react";
import type { ShareImageModel } from "@/lib/share-image";

// The post-workout card, sized to the visible screen: nothing inside it scrolls. Sizes follow the screen's height
// (dvh, so a phone's collapsing browser bars are accounted for) and the least important lines drop out on a short
// screen instead of pushing the rest off the bottom. It draws from the same model as the shareable picture, so what
// is on screen is what gets posted.
export function OneScreenCard({
  model,
  background,
  coachLine,
  hasPr,
  onShuffle,
  funLineHidden,
}: {
  model: ShareImageModel;
  // The scene behind the card (a scenic background or the group's own image), already positioned to fill it.
  background: ReactNode;
  coachLine: { coachFirstName: string; text: string } | null;
  hasPr: boolean;
  // Present only for the client who owns the card: rolls a different fun line.
  onShuffle?: () => void;
  // The line's space is kept but it is not shown while the owner's device is still choosing theirs, so the text never visibly flips after load.
  funLineHidden?: boolean;
}) {
  return (
    <div
      data-testid="one-screen-card"
      className="relative flex-1 min-h-0 overflow-hidden rounded-[22px] border border-chalk/[0.06] bg-gradient-to-b from-[#2E2B28] to-surface"
    >
      <div className="absolute inset-0">
        {background}
        <div className="absolute inset-0 bg-gradient-to-b from-graphite/20 via-graphite/70 to-graphite/95" />
      </div>

      <div className="relative h-full flex flex-col justify-between text-center p-[clamp(14px,3dvh,28px)]">
        <div>
          <p className="font-display uppercase text-[clamp(10px,1.6dvh,12px)] tracking-[0.2em] text-rust truncate">
            {model.brand}
          </p>
          <h1 className="font-display font-bold uppercase leading-none mt-[clamp(6px,1.4dvh,12px)] text-[clamp(34px,7.5dvh,68px)] drop-shadow-[0_2px_6px_rgba(0,0,0,.6)]">
            {model.headline}
            {hasPr ? " 🎉" : ""}
          </h1>
          {coachLine ? (
            <>
              <p className="font-body text-chalk mt-[clamp(6px,1.2dvh,10px)] text-[clamp(12px,1.9dvh,15px)] leading-snug line-clamp-3 [@media(max-height:620px)]:hidden">
                <span className="text-steel">{coachLine.coachFirstName}: </span>
                {coachLine.text}
              </p>
              {model.name && (
                <p className="hidden [@media(max-height:620px)]:block font-body text-[clamp(14px,2.4dvh,20px)] mt-[clamp(4px,1dvh,8px)]">{model.name}</p>
              )}
            </>
          ) : (
            model.name && (
              <p className="font-body text-[clamp(14px,2.4dvh,20px)] mt-[clamp(4px,1dvh,8px)]">{model.name}</p>
            )
          )}
        </div>

        {model.stats.length > 0 && (
          <div
            className="grid gap-2 py-[clamp(8px,1.8dvh,16px)] border-y border-steel/20"
            style={{ gridTemplateColumns: `repeat(${model.stats.length}, minmax(0, 1fr))` }}
          >
            {model.stats.map((s) => (
              <div key={s.label} className="min-w-0">
                <p className="font-display leading-none text-[clamp(22px,min(5.4dvh,9vw),46px)] [font-variant-numeric:tabular-nums] truncate">
                  {s.value}
                </p>
                <p className="font-body text-[10px] text-steel uppercase tracking-wide mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {model.chip && (
          <p className="font-display text-rust text-[clamp(11px,1.8dvh,14px)] tracking-[0.18em] [@media(max-height:620px)]:hidden">
            {model.chip}
          </p>
        )}

        {model.funLine && (
          <div className={`relative py-[clamp(4px,1.2dvh,10px)] [@media(max-height:520px)]:hidden ${funLineHidden ? "invisible" : ""}`}>
            <p
              data-testid="share-fun-line"
              className={`font-body text-chalk/90 text-[clamp(11px,1.65dvh,13.5px)] leading-snug line-clamp-3 drop-shadow-[0_1px_3px_rgba(0,0,0,.7)]`}
            >
              {model.funLine}
            </p>
            {onShuffle && (
              <>
                <button
                  type="button"
                  onClick={onShuffle}
                  data-testid="share-fun-shuffle"
                  className="hidden [@media(min-height:700px)]:flex mx-auto items-center justify-center min-h-[2.75rem] -my-2 px-4 font-body text-[11px] uppercase tracking-wide text-steel underline underline-offset-2 active:text-chalk"
                >
                  Another one
                </button>
              </>
            )}
          </div>
        )}

        {model.lifts.length > 0 && (
          <div className="text-left">
            <p className="font-body text-[10px] text-steel uppercase tracking-wide mb-[clamp(3px,0.8dvh,6px)] [@media(max-height:580px)]:hidden">
              Top lifts today
            </p>
            <div className="space-y-[clamp(3px,0.7dvh,6px)]">
              {model.lifts.map((lift) => (
                <div
                  key={lift.name}
                  className="flex items-center justify-between gap-2 px-3 py-[clamp(4px,1dvh,9px)] rounded-lg bg-chalk/[0.06] last:[@media(max-height:700px)]:hidden [&:nth-child(2)]:[@media(max-height:600px)]:hidden"
                >
                  <span className="font-display uppercase text-[clamp(13px,2.1dvh,17px)] truncate">{lift.name}</span>
                  <span className="font-body text-[clamp(11px,1.8dvh,14px)] text-chalk/80 shrink-0 [font-variant-numeric:tabular-nums]">
                    {lift.detail}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <SpotlightLockup compact />
          <p className="font-body text-[10px] text-steel tracking-wider mt-0.5">{model.dateLabel}</p>
        </div>
      </div>

      {/* A short screen has no room for another row, so the button is a round icon in the bottom corner (beside the date); a taller screen gets the labelled one under the line. */}
      {onShuffle && model.funLine && (
        <button
          type="button"
          onClick={onShuffle}
          data-testid="share-fun-shuffle-icon"
          aria-label="Another one"
          title="Another one"
          className={`[@media(min-height:700px)]:hidden [@media(max-height:520px)]:hidden absolute right-2 bottom-2 w-11 h-11 flex items-center justify-center rounded-full border border-steel/30 bg-graphite/60 text-steel active:text-chalk ${funLineHidden ? "invisible" : ""}`}
        >
          <RefreshCw size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
