// Visual design audit finding (2026-09-14, Ron's own direct word): a
// live DOM scan found stat-tile grids (Business Overview's 8 tiles
// specifically) rendering with completely uniform visual weight — same
// size, same color, same emphasis on every number, so nothing tells the
// eye which one actually matters. Reuses the exact accent treatment
// dashboard-hero.tsx already established for the Home "Right now" card
// (border-rust/40 bg-rust/5, small bold uppercase rust label) rather
// than inventing a new visual language, so a hero number reads as
// consistent with the rest of the app instead of a one-off treatment.
export function StatHeroTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="border border-rust/40 bg-rust/5 p-5 flex flex-col justify-center h-full">
      <p className="font-body text-[10px] text-rust uppercase tracking-wide font-bold mb-2">{label}</p>
      <p className="font-display font-bold text-5xl leading-none text-chalk">{value}</p>
      {detail && <p className="font-body text-xs text-steel mt-2">{detail}</p>}
    </div>
  );
}
