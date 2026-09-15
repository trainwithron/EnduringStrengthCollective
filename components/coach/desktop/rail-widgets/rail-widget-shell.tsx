import Link from "next/link";

// Hover rail widgets (hover_expand_rail_widgets_idea.md) — the shared
// header/footer chrome every rail popover uses, so the 6 widgets read as
// one consistent feature rather than 6 independently-styled boxes. The
// "glow vs. flat" premium motif (v3_finished_picture_visual_bar_
// directive.md) lives on the popover container itself (shell-rail.tsx);
// this just keeps every widget's internal layout consistent.
export function RailWidgetHeader({ title }: { title: string }) {
  return (
    <p className="font-body text-[10px] uppercase tracking-wide text-steel mb-2">{title}</p>
  );
}

export function RailWidgetRow({
  primary,
  secondary,
  href,
}: {
  primary: string;
  secondary?: string;
  href?: string;
}) {
  const content = (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-steel/10 last:border-b-0">
      <span className="font-body text-sm text-chalk truncate">{primary}</span>
      {secondary && (
        <span className="font-body text-[11px] text-steel shrink-0 truncate max-w-[8rem]">{secondary}</span>
      )}
    </div>
  );
  if (!href) return content;
  return (
    <Link href={href} className="block hover:bg-rust/5 -mx-1 px-1 transition-colors">
      {content}
    </Link>
  );
}

export function RailWidgetDeeperLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block mt-2.5 font-body text-xs text-rust underline underline-offset-2">
      {label}
    </Link>
  );
}

export function RailWidgetEmpty({ text }: { text: string }) {
  return <p className="font-body text-xs text-steel italic leading-snug">{text}</p>;
}

export function RailWidgetLoading() {
  return <p className="font-body text-xs text-steel">Loading…</p>;
}
