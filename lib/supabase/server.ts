import { cache } from "react";
import { createServerClient as createSupabaseServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

async function buildServerClient() {
  const cookieStore = await cookies();

  const client = createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render; safe to ignore because
            // middleware.ts refreshes the session on every request.
          }
        },
      },
    }
  );

  // A page render asks "who is this?" several times (root layout theme, the
  // page, helpers) and each call is a network round trip to Supabase Auth.
  // Within one request the answer can't change, so ask once and share it.
  // Calls that pass a JWT explicitly are left alone.
  const originalGetUser = client.auth.getUser.bind(client.auth);
  let pending: ReturnType<typeof originalGetUser> | null = null;
  client.auth.getUser = ((...args: Parameters<typeof originalGetUser>) => {
    if (args.length > 0) return originalGetUser(...args);
    if (!pending) pending = originalGetUser();
    return pending;
  }) as typeof client.auth.getUser;

  return client;
}

// One client per server-rendered request (React.cache), so the memoised
// getUser above is actually shared between the layout and the page. Outside a
// render (route handlers) React.cache does not memoise and every call builds a
// fresh client, exactly as before.
export const createServerClient = cache(buildServerClient);
