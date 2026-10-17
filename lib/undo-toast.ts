// One "Undo" offer at a time, shown for a few seconds after something is deleted (an exercise, a note, a day, a week). A newer delete replaces the older offer.
export interface UndoOffer {
  message: string;
  onUndo: () => Promise<void> | void;
}

export const UNDO_SECONDS = 15;

type Listener = (offer: UndoOffer | null) => void;
const listeners = new Set<Listener>();
let current: UndoOffer | null = null;

export function showUndo(offer: UndoOffer): void {
  current = offer;
  listeners.forEach((l) => l(current));
}

export function clearUndo(): void {
  current = null;
  listeners.forEach((l) => l(null));
}

export function subscribeUndo(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
