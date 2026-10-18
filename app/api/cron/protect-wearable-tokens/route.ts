import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { withCronRun } from "@/lib/cron-monitor";
import { openToken, sealedTokenColumns, tokenCryptoEnabled } from "@/lib/token-crypto";

// Daily: gives every wearable connection its token fingerprint (so Garmin pushes keep finding it) and, once WEARABLE_TOKEN_KEY is set, scrambles the
// tokens that were stored readable. The fingerprint is written in the same update as the scrambling, never after, so a token is never scrambled
// without it. Each update only applies if the row still holds the token that was read (a refresh that lands in between wins and is picked up next
// run). With no key set this only fills fingerprints in. Safe to run any number of times.
export const maxDuration = 300;
const BATCH = 200;
const MAX_BATCHES = 20;

type TokenRow = { id: string; access_token: string; refresh_token: string; access_token_hash?: string | null };

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const supabase = createServiceRoleClient();
  const enabled = tokenCryptoEnabled();
  let wearable = 0;
  let calendar = 0;
  let failed = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const query = supabase.from("wearable_oauth_tokens").select("id, access_token, refresh_token, access_token_hash").limit(BATCH);
    const { data, error } = await (enabled ? query.or("access_token_hash.is.null,access_token.not.like.enc:v1:*") : query.is("access_token_hash", null));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as TokenRow[];
    if (rows.length === 0) break;
    let progressed = 0;
    for (const row of rows) {
      try {
        const columns = sealedTokenColumns({ accessToken: openToken(row.access_token), refreshToken: openToken(row.refresh_token) }, { withHash: true });
        const { data: done, error: updateError } = await supabase
          .from("wearable_oauth_tokens")
          .update(columns)
          .eq("id", row.id)
          .eq("access_token", row.access_token)
          .select("id");
        if (updateError) throw updateError;
        if (done && done.length > 0) {
          wearable += 1;
          progressed += 1;
        }
      } catch (err) {
        failed += 1;
        console.error("protect-wearable-tokens: one connection skipped:", err instanceof Error ? err.message : err);
      }
    }
    if (progressed === 0 || rows.length < BATCH) break;
  }

  if (enabled) {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data, error } = await supabase.from("google_calendar_oauth_tokens").select("id, access_token, refresh_token").not("access_token", "like", "enc:v1:%").limit(BATCH);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data ?? []) as TokenRow[];
      if (rows.length === 0) break;
      let progressed = 0;
      for (const row of rows) {
        try {
          const columns = sealedTokenColumns({ accessToken: openToken(row.access_token), refreshToken: openToken(row.refresh_token) });
          const { data: done, error: updateError } = await supabase.from("google_calendar_oauth_tokens").update(columns).eq("id", row.id).eq("access_token", row.access_token).select("id");
          if (updateError) throw updateError;
          if (done && done.length > 0) {
            calendar += 1;
            progressed += 1;
          }
        } catch (err) {
          failed += 1;
          console.error("protect-wearable-tokens: one calendar connection skipped:", err instanceof Error ? err.message : err);
        }
      }
      if (progressed === 0 || rows.length < BATCH) break;
    }
  }

  return NextResponse.json({ keySet: enabled, wearable, calendar, failed });
}

export const GET = withCronRun("protect-wearable-tokens", handler);
