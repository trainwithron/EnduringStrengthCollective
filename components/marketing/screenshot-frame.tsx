// Consistent chrome around a product preview on the landing page — a
// plain browser-style top bar for desktop previews, a phone-style notch
// bar for mobile ones — so a preview reads as "the actual product" rather
// than a loose floating panel. Takes real markup as children (built from
// this app's own color/type tokens, not a screenshot file) so it always
// matches the current UI and never goes stale as the product evolves.
export function ScreenshotFrame({
  children,
  variant = "desktop",
}: {
  children: React.ReactNode;
  variant?: "desktop" | "mobile";
}) {
  if (variant === "mobile") {
    return (
      <div className="mx-auto w-full max-w-[280px] bg-surface border border-steel/30 rounded-[28px] p-2 shadow-2xl shadow-black/40">
        <div className="h-5 flex items-center justify-center">
          <div className="w-16 h-1.5 rounded-full bg-steel/40" />
        </div>
        <div className="overflow-hidden rounded-[20px] border border-steel/20 bg-graphite">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full bg-surface border border-steel/30 rounded-lg shadow-2xl shadow-black/40 overflow-hidden">
      <div className="h-8 flex items-center gap-1.5 px-3 border-b border-steel/20">
        <span className="w-2.5 h-2.5 rounded-full bg-steel/40" />
        <span className="w-2.5 h-2.5 rounded-full bg-steel/40" />
        <span className="w-2.5 h-2.5 rounded-full bg-steel/40" />
      </div>
      <div className="bg-graphite">{children}</div>
    </div>
  );
}
