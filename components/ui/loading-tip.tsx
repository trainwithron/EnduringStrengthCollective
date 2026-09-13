import { pickLoadingTip } from "@/lib/loading-tips";

// Rendered inside every route-level loading.tsx (custom_shape_theming_idea.md
// / loading_screen_tips_biomechanics_content_bank.md) — turns otherwise-dead
// loading time into a real, sourced "did you know" instead of a blank
// skeleton. A fresh server render picks a new tip each time this loading
// state actually shows.
export function LoadingTip() {
  const tip = pickLoadingTip();
  return (
    <p className="font-body text-xs text-steel/80 leading-relaxed px-1">
      <span className="text-rust">💡</span> {tip.text}
    </p>
  );
}
