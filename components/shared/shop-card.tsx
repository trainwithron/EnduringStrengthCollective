import type { CSSProperties, ReactNode } from "react";

// One storefront card, used by the client's Pro Shop, the coach's preview of it and the public mini site, so they always match: a large 4:3 picture (a quiet placeholder when there is none), the
// name, one short line (the description, two lines at most), and one clear "Shop" button that opens the outbound link in a new tab. A "buy" card (a package the coach sells) also shows its price and a "Buy"
// button, but is drawn ONLY when buying is really possible (canBuy): a visitor never meets a dead Buy. In this release nothing passes canBuy, so no Buy card appears anywhere.
// Colors come from the page: the app's own theme by default, or the public page's palette when `colors` is given.
export interface ShopCardColors {
  card: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
}

export interface ShopCardProps {
  title: string;
  description?: string | null;
  imageUrl?: string | null;
  href: string;
  buttonLabel?: string;
  // A small second line, such as a discount ("10% off with code TEAM10").
  note?: ReactNode;
  // Called when the button is used (the app counts the click); the mini site passes nothing.
  onOpen?: () => void;
  colors?: ShopCardColors;
  id?: string;
  // "shop" (default) is an outbound link; "buy" is a product with a price.
  kind?: "shop" | "buy";
  price?: string | null;
  canBuy?: boolean;
}

export function ShopCard({ title, description, imageUrl, href, buttonLabel, note, onOpen, colors, id, kind = "shop", price = null, canBuy = false }: ShopCardProps) {
  // A Buy card with no working checkout behind it is not drawn at all.
  if (kind === "buy" && !canBuy) return null;
  const label = buttonLabel ?? (kind === "buy" ? "Buy" : "Shop");
  const cardStyle: CSSProperties | undefined = colors ? { background: colors.card, color: colors.text } : undefined;
  const mutedStyle: CSSProperties | undefined = colors ? { color: colors.muted } : undefined;
  const buttonStyle: CSSProperties | undefined = colors ? { background: colors.accent, color: colors.accentText } : undefined;
  return (
    <div id={id} className={`flex flex-col overflow-hidden ${colors ? "" : "bg-surface border border-steel/20"}`} style={cardStyle}>
      <div className="aspect-[4/3] w-full overflow-hidden" style={colors ? { background: "rgba(127,127,127,0.12)" } : undefined}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- outbound shop image chosen by the coach.
          <img src={imageUrl} alt={title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className={`h-full w-full flex items-center justify-center ${colors ? "" : "bg-graphite/60 text-steel/50"}`} style={mutedStyle} aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-10 w-10 opacity-50" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 7h12l1 13H5L6 7Z" />
              <path d="M9 7a3 3 0 0 1 6 0" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className={`font-body font-semibold text-[15px] leading-snug ${colors ? "" : "text-chalk"}`}>{title}</h3>
        {description ? (
          <p className={`font-body text-sm leading-snug line-clamp-2 ${colors ? "" : "text-steel"}`} style={mutedStyle}>
            {description}
          </p>
        ) : null}
        {kind === "buy" && price ? <p className={`font-body text-sm font-semibold ${colors ? "" : "text-chalk"}`}>{price}</p> : null}
        {note ? <div className={`font-body text-xs ${colors ? "" : "text-positive"}`}>{note}</div> : null}
        <div className="mt-auto pt-2">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpen}
            className={`flex min-h-11 w-full items-center justify-center px-4 font-display font-bold uppercase tracking-wide text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${colors ? "" : "bg-rust text-graphite"}`}
            style={buttonStyle}
          >
            {label}
            <span className="sr-only"> {title} (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </div>
  );
}

// The grid: two columns on a phone, three on a tablet, four on a wide screen.
export function ShopGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>;
}
