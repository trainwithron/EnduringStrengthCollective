// A section header in a client's workout ("Warm-up", "Strength"; B3), above the exercise it heads. The same line in the coach's preview, the workout overview and the logger.
export function SectionHeaderLines({ headers }: { headers: string[] | undefined }) {
  if (!headers || headers.length === 0) return null;
  return (
    <>
      {headers.map((h, i) => (
        <h3 key={i} className="font-display uppercase text-sm tracking-wide text-rust-ink pt-4 pb-1 border-b border-rust/40" data-section-header>
          {h}
        </h3>
      ))}
    </>
  );
}
