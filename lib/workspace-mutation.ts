// Cross-pane refresh: when something is SAVED in one pane (or on the main page), the others should show it without the coach pressing reload. Saves in this app are
// requests to its own /api routes or to the database (Supabase REST), so ONE wrapper around fetch notices a successful write and tells whoever is listening.
//
// The wrapper is installed as soon as this file is loaded (not later, from an effect): the database client remembers the fetch it finds when it is created, so a client
// created before the wrapper would write without being noticed. Only real SAVES count: a read that happens to be sent as a POST (a chat question, a search, a
// calculator, a database function that only reads) must not make every pane refresh.

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// The app's own routes that SAVE coach or client data. Anything else under /api (chat, AI, search, calculators, push, health...) is not a save.
const SAVING_API = /^\/api\/(clients|invites|series|bookings|credits|group-sessions|organizations|broadcast|sms|webhooks|reup|legal|account|calendar-spotter|google-calendar|coach\/(packages|package-assignments|set-swipe-direction|video-checkin))(\/|$)/;

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

// What a page can tell the workspace that holds it: how many saves are still in flight, and whether the coach typed something that has not been saved since.
export const paneActivity = { inFlight: 0, typed: false };

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
    paneActivity.inFlight += 1;
    try {
      const response = await original.call(window, input, init);
      if (response.ok) {
        paneActivity.typed = false;
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
