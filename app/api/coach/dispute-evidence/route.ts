import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { utf8, zipStream, type ZipEntry } from "@/lib/zip-store";
import { evidenceFiles, loadDisputeEvidence } from "@/lib/dispute-evidence";
import { DISPUTE_UPLOAD_LINE } from "@/lib/billing-help";
import { getViewerDisplayTimezone } from "@/lib/display-timezone-server";

// Evidence for a card dispute, as a ZIP of spreadsheets ($6, Ron Nov 20): the same facts as the printable page (lib/dispute-evidence.ts), for one payment, for a coach of that
// client only. Read only: nothing is written and nothing is sent to Stripe.
export async function GET(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const purchaseId = new URL(request.url).searchParams.get("purchaseId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(purchaseId)) return NextResponse.json({ error: "Missing the payment." }, { status: 400 });

  const limited = await rateLimitResponse("coach-dispute-evidence", user.id, 30, 3600);
  if (limited) return limited;

  const loaded = await loadDisputeEvidence(supabase, createServiceRoleClient(), { purchaseId, viewerId: user.id });
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

  const timeZone = await getViewerDisplayTimezone(supabase, user.id);
  const files = evidenceFiles(loaded.evidence, timeZone, DISPUTE_UPLOAD_LINE);
  async function* one(text: string) {
    yield utf8(text);
  }
  // a spreadsheet gets the byte-order mark so Excel reads names and accents right
  const entries: ZipEntry[] = files.map((f) => ({ name: f.name, chunks: one(f.name.endsWith(".csv") ? "﻿" + f.text : f.text) }));
  const day = loaded.evidence.payment.createdAt.slice(0, 10);
  return new Response(zipStream(entries), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="dispute-evidence-${day}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
