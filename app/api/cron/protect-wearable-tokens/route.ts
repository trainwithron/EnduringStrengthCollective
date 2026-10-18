import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";
import { openToken, sealedTokenColumns, tokenCryptoEnabled, tokenOwner } from "@/lib/token-crypto";

// Daily: gives every wearable connection its token fingerprint (so Garmin pushes keep finding it) and, once WEARABLE_TOKEN_KEY is set, scrambles the
// tokens that were stored readable. The fingerprint is written in the same update as the scrambling, never after, so a token is never scrambled
// without it. Each update only applies if the row still holds the token that was read (a refresh that lands in between wins and is picked up next
// run). With no key set this only fills fingerprints in. Rows are walked in id order and a row that fails is passed over, never retried in the same
// run, so a few unreadable connections cannot hold up the rest. A run where anything failed, or the key is unusable, answers 500 so it is recorded as
// failed and the platform administrator is told. Safe to run any number of times.
export const maxDuration = 300;
const BATCH = 200;
const MAX_BATCHES = 20;

type Connection = { profile_id: string; provider: string } | null;
type CalendarConnection = { coach_id: string } | null;
type TokenRow = { id: string; access_token: string; refresh_token: string; wearable_connections?: Connection | Connection[]; google_calendar_connections?: CalendarConnection | CalendarConnection[] };
const one = <T,>(v: T | T[] | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let enabled: boolean;
  try {
    enabled = tokenCryptoEnabled();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "WEARABLE_TOKEN_KEY is not usable." }, { status: 500 });
  }

  const supabase = createServiceRoleClient();
  let wearable = 0;
  let calendar = 0;
  let failed = 0;

  // One pass over a table in id order: `needs` says which rows still need work, `work` does one row. A row that fails is counted and skipped.
  async function pass(table: "wearable_oauth_tokens" | "google_calendar_oauth_tokens", select: string, filter: (q: any) => any, work: (row: TokenRow) => Promise<boolean>): Promise<number | Response> {
    let done = 0;
    let lastId = "";
    for (let i = 0; i < MAX_BATCHES; i++) {
      let query = supabase.from(table).select(select).order("id", { ascending: true }).limit(BATCH);
      if (lastId) query = query.gt("id", lastId);
      const { data, error } = await filter(query);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data ?? []) as unknown as TokenRow[];
      if (rows.length === 0) break;
      for (const row of rows) {
        lastId = row.id;
        try {
          if (await work(row)) done += 1;
        } catch (err) {
          failed += 1;
          console.error(`protect-wearable-tokens: one ${table} row skipped:`, err instanceof Error ? err.message : "unknown");
        }
      }
      if (rows.length < BATCH) break;
    }
    return done;
  }

  const w = await pass(
    "wearable_oauth_tokens",
    "id, access_token, refresh_token, wearable_connections ( profile_id, provider )",
    (q) => (enabled ? q.or("access_token_hash.is.null,access_token.not.like.enc:v1:*") : q.is("access_token_hash", null)),
    async (row) => {
      const conn = one(row.wearable_connections);
      if (!conn) throw new Error("no connection for this token row");
      const owner = tokenOwner("wearable", conn.provider, conn.profile_id);
      const plain = { accessToken: openToken(row.access_token, owner, "access"), refreshToken: openToken(row.refresh_token, owner, "refresh") };
      const columns = sealedTokenColumns(plain, owner, { withHash: true });
      const { data: done, error } = await supabase.from("wearable_oauth_tokens").update(columns).eq("id", row.id).eq("access_token", row.access_token).select("id");
      if (error) throw error;
      return !!done && done.length > 0;
    },
  );
  if (typeof w !== "number") return w;
  wearable = w;

  if (enabled) {
    const c = await pass(
      "google_calendar_oauth_tokens",
      "id, access_token, refresh_token, google_calendar_connections ( coach_id )",
      (q) => q.not("access_token", "like", "enc:v1:%"),
      async (row) => {
        const conn = one(row.google_calendar_connections);
        if (!conn) throw new Error("no connection for this token row");
        const owner = tokenOwner("calendar", "google", conn.coach_id);
        const plain = { accessToken: openToken(row.access_token, owner, "access"), refreshToken: openToken(row.refresh_token, owner, "refresh") };
        const columns = sealedTokenColumns(plain, owner);
        const { data: done, error } = await supabase.from("google_calendar_oauth_tokens").update(columns).eq("id", row.id).eq("access_token", row.access_token).select("id");
        if (error) throw error;
        return !!done && done.length > 0;
      },
    );
    if (typeof c !== "number") return c;
    calendar = c;
  }

  const body = { keySet: enabled, wearable, calendar, failed };
  return NextResponse.json(failed > 0 ? { ...body, error: `${failed} connection(s) could not be protected; see the logs.` } : body, { status: failed > 0 ? 500 : 200 });
}

export const GET = withCronRun("protect-wearable-tokens", handler);
