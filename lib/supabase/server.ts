import { createServerClient as createSupabaseServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies, type UnsafeUnwrappedCookies } from "next/headers";

export function createServerClient() {
  const cookieStore = (cookies() as unknown as UnsafeUnwrappedCookies);

  return createSupabaseServerClient(
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
}
