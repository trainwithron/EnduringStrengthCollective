// Cross-pane refresh: when something is SAVED in one pane (or on the main page), the others should show it without the coach pressing reload. Saves in this app are
// requests to its own /api routes or to the database (Supabase REST), so ONE wrapper around fetch notices a successful write and tells whoever is listening.
//
// The wrapper is installed as soon as this file is loaded (not later, from an effect): the database client remembers the fetch it finds when it is created, so a client
// created before the wrapper would write without being noticed. Only real SAVES count: a read that happens to be sent as a POST (a chat question, a search, a
// calculator, a database function that only reads) must not make every pane refresh.

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// The app's own routes that SAVE coach or client data. A test (workspace-mutation.test.ts) walks every route that can write and fails if a route is neither here nor in
// that test's explicit NOT_A_SAVE list, so a new route cannot be missed by accident.
export const SAVING_API =
  /^\/api\/(clients|invites|bookings|credits|group-sessions|group-events|organizations|broadcast|sms|webhooks|reup|legal|account|messages\/thread|calendar-spotter|google-calendar|zapier|assistant\/action|kiosk\/checkin|org-dispatch\/(accept|decline|reply|ask-question)|programming-spotter\/(dismiss|feedback|stop-suggesting)|coaches\/invite|series(?!\/preview)|ai\/(refund-credit|meal-plan-credit-charge|program-chat\/confirm-rule|sign-off)|learned-rules|coach\/(packages|package-assignments|dashboard-layout|api-key|video-checkin)|nutrition\/plan-retry)(\/|$)/;

// Database functions that only read (named like reads). Everything else called through /rest/v1/rpc/ is treated as a save.
const READ_RPC = /^((get|list|search|check|is|has|can|fetch|count|find|preview)_|coach_roster|booking_counts|group_leaderboard|athlete_|coach_client_steps|coach_inbox|org_billable|org_coach_seats|group_session_counts|training_partner)/;

export function isWriteRequest(method: string | undefined, url: string, origin: string, supabaseUrl: string | undefined): boolean {
  if (!WRITE_METHODS.has((method ?? "GET").toUpperCase())) return false;
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  if (u.origin === origin && u.pathname.startsWith("/api/")) return SAVING_API.test(u.pathname);
  if (supabaseUrl) {
    try {
      const s = new URL(supabaseUrl);
      if (u.origin === s.origin && u.pathname.startsWith("/rest/v1/")) {
        const rpc = /^\/rest\/v1\/rpc\/([^/?]+)/.exec(u.pathname);
        return rpc ? !READ_RPC.test(rpc[1]) : true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

// Many writes happen together (a save that makes five requests): one refresh is enough. Returns a function to call on each write; `run` fires once after `ms` of quiet.
export function debounce(run: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run();
    }, ms);
  };
}

// An automatic refresh limit: at most `max` in any `windowMs`. `allow(now)` records and answers.
export function createRefreshLimiter(max: number, windowMs: number) {
  let stamps: number[] = [];
  return {
    allow(now: number = Date.now()): boolean {
      stamps = stamps.filter((t) => now - t < windowMs);
      if (stamps.length >= max) return false;
      stamps.push(now);
      return true;
    },
    reset() {
      stamps = [];
    },
  };
}

export const MUTATION_MESSAGE = "esc-workspace-mutated";
export const REFRESH_MESSAGE = "esc-workspace-refresh";
export const SIGNED_OUT_MESSAGE = "esc-workspace-signed-out";

// ---- typed text that has not been saved (so closing a pane never throws a draft away) ----
// Only a field a person WRITES in counts (a message box, a note, a text input): not a search or filter box, a checkbox or a number stepper.
export interface FieldInfo {
  tag: string;
  type?: string | null;
  role?: string | null;
  placeholder?: string | null;
  ariaLabel?: string | null;
  inSearchRegion?: boolean;
  contentEditable?: boolean;
}
const WRITING_INPUT_TYPES = new Set(["text", "email", "tel", "url", "password", ""]);
export function isDraftField(f: FieldInfo): boolean {
  if (f.inSearchRegion || f.role === "searchbox" || f.role === "combobox") return false;
  if (/search|filter/i.test(`${f.placeholder ?? ""} ${f.ariaLabel ?? ""}`)) return false;
  const tag = f.tag.toUpperCase();
  if (tag === "TEXTAREA" || f.contentEditable) return true;
  if (tag === "INPUT") return WRITING_INPUT_TYPES.has((f.type ?? "").toLowerCase()) && (f.type ?? "").toLowerCase() !== "password";
  return false;
}

// A field counts as saved when it was left and a save that began right after it succeeded (the app saves a field when it loses focus). An unrelated save does not
// clear it, and a message that was never sent (no save follows) stays unsaved.
const SAVE_AFTER_BLUR_MS = 3000;
const dirty = new Set<Element>();
const blurredAt = new Map<Element, number>();

export function noteDraftInput(el: Element) {
  dirty.add(el);
  blurredAt.delete(el);
}
export function noteDraftBlur(el: Element, now: number = Date.now()) {
  if (dirty.has(el)) blurredAt.set(el, now);
}
function clearSavedFields(writeStartedAt: number) {
  for (const el of Array.from(dirty)) {
    const left = blurredAt.get(el);
    if (!el.isConnected || (left !== undefined && writeStartedAt >= left - 50 && writeStartedAt - left <= SAVE_AFTER_BLUR_MS)) {
      dirty.delete(el);
      blurredAt.delete(el);
    }
  }
}
// A box that is empty again holds nothing to lose: a message sent with the Enter key (the box is cleared, it never loses focus) is not unsaved.
export function fieldIsEmpty(el: Element): boolean {
  const anyEl = el as unknown as { value?: unknown; textContent?: string | null; isContentEditable?: boolean };
  if (typeof anyEl.value === "string") return anyEl.value.trim() === "";
  return (anyEl.textContent ?? "").trim() === "";
}

export function hasUnsavedTyping(): boolean {
  for (const el of Array.from(dirty)) {
    if (!el.isConnected || fieldIsEmpty(el)) {
      dirty.delete(el);
      blurredAt.delete(el);
    }
  }
  return dirty.size > 0;
}

// A page may be sent to start over (the signed-in person changed under it) at most once in a while: if it keeps disagreeing, it must not reload in a loop.
export function shouldReloadNow(lastReloadMs: number | null, now: number, windowMs = 30_000): boolean {
  return lastReloadMs === null || now - lastReloadMs >= windowMs;
}

// What a page can tell the workspace that holds it: how many saves are still in flight, and whether anything typed was never saved.
export const paneActivity = {
  inFlight: 0,
  get typed(): boolean {
    return hasUnsavedTyping();
  },
};

const writeListeners = new Set<() => void>();
let wrapped = false;

function ensureFetchWrapped() {
  if (wrapped || typeof window === "undefined") return;
  wrapped = true;
  const original = window.fetch;
  const origin = window.location.origin;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  window.fetch = async function wrappedFetch(input, init) {
    let isWrite = false;
    try {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      isWrite = isWriteRequest(method, url, origin, supabaseUrl);
    } catch {
      // Reporting is never allowed to break a request.
    }
    if (!isWrite) return original.call(window, input, init);
    const startedAt = Date.now();
    paneActivity.inFlight += 1;
    try {
      const response = await original.call(window, input, init);
      if (response.ok) {
        clearSavedFields(startedAt);
        writeListeners.forEach((fn) => {
          try {
            fn();
          } catch {
            // a listener must not break a save
          }
        });
      }
      return response;
    } finally {
      paneActivity.inFlight -= 1;
    }
  };
}

// Called when a successful save happens. Returns the function that stops listening.
export function installMutationReporter(onWrite: () => void): () => void {
  ensureFetchWrapped();
  writeListeners.add(onWrite);
  return () => {
    writeListeners.delete(onWrite);
  };
}

// Installed at load, before any component can create a database client (see the top of this file).
ensureFetchWrapped();
