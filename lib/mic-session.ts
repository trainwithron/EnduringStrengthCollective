// The listening logic behind the microphone button, kept apart from the page so it can be tested with a fake recognition object.
// The browser ends continuous listening on its own after a silence; to the coach that looks like the mic cutting them off mid-sentence. So in continuous mode a session that ends by itself starts again until the
// coach taps stop, with a guard against a restart loop (denied permission, or a mic that ends at once, again and again). Words are taken as they are heard: finished phrases as they finish, and a phrase still
// unfinished when listening ends is kept instead of lost. Pure apart from the recognition object it is given.

export interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
  start(): void;
  stop(): void;
}

export const QUICK_END_MS = 1500; // a session shorter than this that ends by itself counts as a quick end
export const MAX_QUICK_ENDS = 3; // this many quick ends in a row and listening stops instead of restarting again
const FATAL_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

export function createMicSession({
  make,
  continuous,
  onText,
  onListening,
  now = () => Date.now(),
}: {
  make: () => RecognitionLike;
  continuous: boolean;
  onText: (text: string) => void;
  onListening: (listening: boolean) => void;
  now?: () => number;
}) {
  let wanted = false;
  let rec: RecognitionLike | null = null;
  let startedAt = 0;
  let quickEnds = 0;
  let fatal = false;
  let pending = ""; // heard but not yet finished by the browser

  function flush() {
    const text = pending.trim();
    pending = "";
    if (text) onText(text);
  }

  function finish() {
    wanted = false;
    rec = null;
    onListening(false);
  }

  function begin(): boolean {
    let next: RecognitionLike;
    try {
      next = make();
      next.lang = "en-US";
      next.interimResults = true;
      next.continuous = continuous;
      next.onresult = (e: any) => {
        // Only what is new since the last event: the results list keeps growing in continuous mode.
        const finals: string[] = [];
        let interim = "";
        const list = Array.from((e.results ?? []) as ArrayLike<any>);
        for (let i = e.resultIndex ?? 0; i < list.length; i++) {
          const r = list[i];
          const t = String(r?.[0]?.transcript ?? "");
          if (r?.isFinal !== false) finals.push(t);
          else interim += t;
        }
        const said = finals.join(" ").trim();
        if (said) {
          pending = "";
          onText(said);
        }
        if (interim.trim()) pending = interim;
      };
      next.onerror = (e: any) => {
        if (FATAL_ERRORS.has(String(e?.error ?? ""))) fatal = true;
      };
      next.onend = () => {
        if (rec !== next) return;
        flush();
        const lasted = now() - startedAt;
        quickEnds = lasted < QUICK_END_MS ? quickEnds + 1 : 0;
        if (wanted && continuous && !fatal && quickEnds < MAX_QUICK_ENDS) {
          if (begin()) return;
        }
        finish();
      };
      rec = next;
      startedAt = now();
      next.start();
      return true;
    } catch {
      return false;
    }
  }

  return {
    start() {
      if (wanted) return;
      wanted = true;
      fatal = false;
      quickEnds = 0;
      pending = "";
      onListening(true);
      if (!begin()) finish();
    },
    // The coach tapped stop: whatever was heard but not finished is kept.
    stop() {
      if (!wanted) return;
      wanted = false;
      const current = rec;
      try {
        current?.stop();
      } catch {
        flush();
        finish();
      }
    },
    isListening: () => wanted,
  };
}
