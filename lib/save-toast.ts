// Tiny pub/sub so any Program Builder component can flash a "Saved"
// confirmation after a successful auto-persist, without prop-drilling a
// callback through every layer (day-card -> week-grid ->
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

export interface SaveToastChannel {
  flashSaved: () => void;
  flashSaveError: (message?: string) => void;
  subscribeSaveToast: (listener: Listener) => () => void;
}

// A channel is one independent pub/sub bus — the fix for a real bug
// (spot_code_chat_commits_code_review_findings_sept29.md #1): the
// Program Builder can be mounted TWICE at once (the full page plus a
// different program open in ShellListPanel's embedded copy), and a
// single shared global bus meant editing Program A flashed a false
// "Saved ✓" on Program B's status bar too. Each ProgramBuilderDesktop
// instance now creates its own channel via createSaveToastChannel() and
// provides it through SaveToastChannelContext, so only its own subtree
// hears its own saves.
export function createSaveToastChannel(): SaveToastChannel {
  const listeners = new Set<Listener>();
  return {
    flashSaved() {
      listeners.forEach((l) => l({ kind: "saved" }));
    },
    flashSaveError(message = "Couldn't save that change.") {
      listeners.forEach((l) => l({ kind: "error", message }));
    },
    subscribeSaveToast(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The original module-level singleton — kept as the default channel for
// every call site that isn't part of the Program Builder tree (e.g. the
// dashboard's RecapAndUpNext widget, which mounts its own <SaveToast />
// and is never mounted twice at once, so it never had this bug and needs
// no scoping of its own).
const defaultChannel = createSaveToastChannel();

export const flashSaved = defaultChannel.flashSaved;
export const flashSaveError = defaultChannel.flashSaveError;
export const subscribeSaveToast = defaultChannel.subscribeSaveToast;
