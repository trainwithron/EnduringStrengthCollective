import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";
import { workspaceFetch } from "@/lib/workspace-header";

// The browser database client. Every data request carries the open workspace (lib/workspace-header.ts). `crossOrg: true` builds a client that does not, for the few flows that deliberately
// reach into a second organization (copying a program into another organization).
export function createBrowserClient(options: { crossOrg?: boolean } = {}) {
  if (options.crossOrg) {
    return createSupabaseBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { isSingleton: false });
  }
  const client = createSupabaseBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { fetch: workspaceFetch } });
  // In the browser this is one client for the whole app: share its "who is this?" (below), the same as the server client does within one request.
  return typeof window === "undefined" ? client : shareGetUser(client);
}

// A page's components each ask "who is this?" when they load (well over a hundred of them do), and on a phone each one waited its turn on the auth lock for its own round trip
// to Supabase Auth. The answer is the same for all of them until the sign-in changes, so the first call's answer is shared: calls with no arguments get the same promise, until a
// sign-in, sign-out, token refresh or account update clears it. A call that passes a token is always its own. A failed answer is never kept.
interface AuthLike {
  auth: {
    getUser: (...args: any[]) => Promise<any>;
    onAuthStateChange: (callback: (event: string, session: unknown) => void) => unknown;
  };
}

const CLEARS_ON = new Set(["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED", "TOKEN_REFRESHED"]);
const shared = new WeakSet<object>();

export function shareGetUser<C extends AuthLike>(client: C): C {
  if (shared.has(client)) return client;
  shared.add(client);
  const original = client.auth.getUser.bind(client.auth);
  let pending: Promise<any> | null = null;
  client.auth.getUser = ((...args: any[]) => {
    if (args.length > 0) return original(...args);
    if (!pending) {
      const p = original();
      pending = p;
      // An error (no signal, a lapsed session) is not an answer to keep.
      p.then(
        (res: any) => {
          if (res?.error && pending === p) pending = null;
        },
        () => {
          if (pending === p) pending = null;
        }
      );
    }
    return pending;
  }) as C["auth"]["getUser"];
  client.auth.onAuthStateChange((event) => {
    if (CLEARS_ON.has(event)) pending = null;
  });
  return client;
}
