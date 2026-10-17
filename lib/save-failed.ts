// One "That didn't save" bar for the whole app. A screen that wrote something and found it did not save calls showSaveFailed; the bar (components/ui/save-failed-toast.tsx, mounted once in the root layout)
// stays up for a few seconds. A newer message replaces the older one.
type Listener = (message: string | null) => void;
const listeners = new Set<Listener>();
let current: string | null = null;

export const SAVE_FAILED_SECONDS = 8;

export function showSaveFailed(message: string): void {
  current = message;
  listeners.forEach((l) => l(current));
}

export function clearSaveFailed(): void {
  current = null;
  listeners.forEach((l) => l(null));
}

export function subscribeSaveFailed(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
