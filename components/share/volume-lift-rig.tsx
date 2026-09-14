// Post-workout share card's animated volume-equivalence rig
// (post_workout_card_v1_bevel_and_animation.md) — one generic bar+plates
// "lift" animation with the reference object's own emoji
// (lib/volume-equivalence.ts) dropped onto the plate. Covers every
// reference object in that file for free, no per-object art needed.
export function VolumeLiftRig({ emoji }: { emoji: string }) {
  return (
    <div className="relative h-[110px] flex items-center justify-center overflow-hidden">
      <div className="absolute left-0 right-0 bottom-5 h-px bg-steel/15" />
      <div className="share-card-lift-rig relative">
        <span className="share-card-spark absolute -top-2 left-1/2 -translate-x-1/2 text-rust text-xs">
          ✦
        </span>
        <div className="flex items-center">
          <span className="w-6 h-6 text-xs rounded-full bg-graphite border-2 border-chalk/[0.14] flex items-center justify-center shadow-[0_8px_16px_-6px_rgba(0,0,0,.6)]">
            ⚪
          </span>
          <span className="w-11 h-11 text-2xl rounded-full bg-graphite border-2 border-chalk/[0.14] flex items-center justify-center shadow-[0_8px_16px_-6px_rgba(0,0,0,.6)]">
            {emoji}
          </span>
          <span className="w-[90px] h-[7px] rounded-[3px] bg-gradient-to-b from-steel/60 to-graphite shadow-[0_2px_4px_rgba(0,0,0,.4)_inset]" />
          <span className="w-11 h-11 text-2xl rounded-full bg-graphite border-2 border-chalk/[0.14] flex items-center justify-center shadow-[0_8px_16px_-6px_rgba(0,0,0,.6)]">
            {emoji}
          </span>
          <span className="w-6 h-6 text-xs rounded-full bg-graphite border-2 border-chalk/[0.14] flex items-center justify-center shadow-[0_8px_16px_-6px_rgba(0,0,0,.6)]">
            ⚪
          </span>
        </div>
      </div>
    </div>
  );
}
