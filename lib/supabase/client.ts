import { createBrowserClient as createSupabaseBrowserClient } from "@supabase/ssr";
import { workspaceFetch } from "@/lib/workspace-header";

// The browser database client. Every data request carries the open workspace (lib/workspace-header.ts). `crossOrg: true` builds a client that does not, for the few flows that deliberately
// reach into a second organization (copying a program into another organization).
export function createBrowserClient(options: { crossOrg?: boolean } = {}) {
  if (options.crossOrg) {
    return createSupabaseBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { isSingleton: false });
  }
  return createSupabaseBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { fetch: workspaceFetch } });
}
