// Tiny module-level pub/sub so any Program Builder component can flash a
// "Saved" confirmation after a successful auto-persist, without prop-
// drilling a callback through every layer (day-card -> week-grid ->
// program-builder-desktop) or wrapping the whole tree in a context
// provider just for this. One <SaveToast /> mounted once at the top of
// the builder listens; every call site imports flashSaved()/flashSaveError()
// directly.
//
// flashSaveError exists because almost every auto-persist call site used
// to ignore the Supabase error it got back entirely — a failed save (a
// dropped connection, an RLS surprise, whatever) looked identical to a
// successful one, since there's no Save button and thus no natural place
// an error would otherwise surface. Every call site should now check its
// own error and call this instead of flashSaved() when one comes back.
type ToastEvent = { kind: "saved" } | { kind: "error"; message: string };
type Listener = (event: ToastEvent) => void;
const listeners = new Set<Listener>();

export function flashSaved() {
  listeners.forEach((l) => l({ kind: "saved" }));
}

export function flashSaveError(message = "Couldn't save that change.") {
  listeners.forEach((l) => l({ kind: "error", message }));
}

export function subscribeSaveToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
