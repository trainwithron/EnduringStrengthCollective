import { createClient } from "@supabase/supabase-js";

// The one privileged Supabase client in this app — bypasses RLS entirely,
// and is the only client allowed to call the Supabase Auth admin API
// (auth.admin.*). Used by the Stripe checkout/webhook routes (no user
// session to check against there — the webhook is called by Stripe
// directly, authenticated by its signature, not a cookie) and by
// server-only admin actions like inviting a new client by email. Never
// import this into a client component or any route that already has a
// real user session to work with — use lib/supabase/server.ts for those,
// exactly as every other route in this app already does; only reach for
// this one when the action genuinely has no session to check RLS
// against, or needs the admin auth API specifically.
export function createServiceRoleClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
