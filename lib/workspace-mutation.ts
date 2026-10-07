// Cross-pane refresh: when something is SAVED in one pane (or on the main page), the others should show it without the coach pressing reload. Saves in this app are
// requests to its own /api routes or to the database (Supabase REST), so a wrapper around fetch notices a successful write and tells whoever is listening.
// Pure helpers here (what counts as a write); the wrapper itself is installed by the workspace provider and by an embedded page.

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isWriteRequest(method: string | undefined, url: string, origin: string, supabaseUrl: string | undefined): boolean {
  if (!WRITE_METHODS.has((method ?? "GET").toUpperCase())) return false;
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  // Our own routes: but not the ones that are only reading or only measuring.
  if (u.origin === origin && u.pathname.startsWith("/api/")) {
    return !/^\/api\/(health|push\/subscribe|ai\/usage|notifications\/read|feedback)/.test(u.pathname);
  }
  // The database: a write to the REST API or a function call (not auth refreshes, not storage uploads).
  if (supabaseUrl) {
    try {
      const s = new URL(supabaseUrl);
      if (u.origin === s.origin) return u.pathname.startsWith("/rest/v1/");
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

export const MUTATION_MESSAGE = "esc-workspace-mutated";

// Wraps window.fetch once; `onWrite` is called after a write that succeeded. Returns an undo function.
export function installMutationReporter(onWrite: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const original = window.fetch;
  const origin = window.location.origin;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const wrapped: typeof window.fetch = async (input, init) => {
    const response = await original.call(window, input, init);
    try {
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (response.ok && isWriteRequest(method, url, origin, supabaseUrl)) onWrite();
    } catch {
      // Reporting is never allowed to break a save.
    }
    return response;
  };
  window.fetch = wrapped;
  return () => {
    if (window.fetch === wrapped) window.fetch = original;
  };
}
