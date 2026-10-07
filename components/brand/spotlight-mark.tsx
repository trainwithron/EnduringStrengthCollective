import { BRAND, brandMarkSrc, type BrandBackground } from "@/lib/brand";

// The Spotlight mark, from the one source in lib/brand.ts. An organisation's own logo (customLogoUrl) wins when there is one; otherwise the default mark that suits the
// background: the "dark" file is drawn for dark backgrounds, the "light" one for light backgrounds.
export function SpotlightMark({
  customLogoUrl = null,
  background = "dark",
  className = "h-8 w-auto",
}: {
  customLogoUrl?: string | null;
  background?: BrandBackground;
  className?: string;
}) {
  return (
    // A plain image on purpose: the file may be an uploaded logo of any size, and the default is a small SVG.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brandMarkSrc(customLogoUrl, background)} alt="" className={className} />
  );
}

// The mark with the wordmark beside it: "SPOTLIGHT" in the condensed display type used on the workout screens, letter-spaced, with a smaller "COACHING" under it.
// Real text, not outlines, so it follows the theme's display font and colours.
export function SpotlightLockup({
  background = "dark",
  compact = false,
  className = "",
}: {
  background?: BrandBackground;
  compact?: boolean;
  className?: string;
}) {
  const text = background === "light" ? "text-graphite" : "text-chalk";
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <SpotlightMark background={background} className={compact ? "h-6 w-6 shrink-0" : "h-10 w-10 shrink-0"} />
      <div className="leading-none">
        <p className={`font-display font-bold ${text} ${compact ? "text-[11px] tracking-[0.4em]" : "text-base tracking-[0.4em]"}`}>{BRAND.wordmark}</p>
        <p className={`font-display font-bold text-steel ${compact ? "text-[8px] tracking-[0.5em] mt-1" : "text-[10px] tracking-[0.5em] mt-1.5"}`}>{BRAND.wordmarkSub}</p>
      </div>
    </div>
  );
}
