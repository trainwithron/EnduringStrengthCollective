// Tiny module-level pub/sub so any Program Builder component can flash a
// "Saved" confirmation after a successful auto-persist, without prop-
// drilling a callback through every layer (day-card -> week-grid ->
// program-builder-desktop) or wrapping the whole tree in a context
// provider just for this. One <SaveToast /> mounted once at the top of
// the builder listens; every call site imports flashSaved() directly.
type Listener = () => void;
const listeners = new Set<Listener>();

export function flashSaved() {
  listeners.forEach((l) => l());
}

export function subscribeSaveToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
