import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPlaceholderEmail } from "@/lib/placeholder-email";

// A client who signed up from a group link has to confirm their email before they can sign in; if that email never arrives (or is never opened) they sit in the list as an ordinary active client, for weeks (Oct 19
// audit: two clients, since Sept 10 and Sept 24). The coach's Clients list marks them "Email not confirmed". The login service is the only place that knows, so this reads it: only the ids and a yes/no, never an address.
// A client the coach set up who has not claimed the account (a placeholder address that can never receive mail) is a different state ("Not signed in yet") and is left out.
export interface AuthUserLite {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

export function unconfirmedIds(users: AuthUserLite[]): string[] {
  return users.filter((u) => !u.email_confirmed_at && !!u.email && !isPlaceholderEmail(u.email)).map((u) => u.id);
}

const MAX_PAGES = 10; // up to 10,000 accounts; beyond that the mark simply does not appear (never a wrong one)

async function readUnconfirmed(): Promise<string[]> {
  const db = createServiceRoleClient();
  const out: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const users = (data?.users ?? []) as AuthUserLite[];
    out.push(...unconfirmedIds(users));
    if (users.length < 1000) break;
  }
  return out;
}

// Cached for five minutes (it is the same answer for every coach, and only ids are held), so opening the Clients list does not read every account each time. A failed read gives no marks, never a wrong one.
const cached = unstable_cache(readUnconfirmed, ["unconfirmed-user-ids"], { revalidate: 300 });

export async function loadUnconfirmedUserIds(): Promise<Set<string>> {
  try {
    return new Set(await cached());
  } catch {
    return new Set();
  }
}
