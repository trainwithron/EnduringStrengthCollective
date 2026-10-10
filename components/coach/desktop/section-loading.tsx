// What shows for a part of a page that is still loading while the rest is already on screen.
export function SectionLoading() {
  return (
    <p className="font-body text-xs text-steel py-3" role="status">
      Loading…
    </p>
  );
}
