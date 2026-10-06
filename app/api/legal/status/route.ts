import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { documentsNeedingAcceptance } from "@/lib/legal-status";

// Which documents the signed-in person still has to accept at their current version. Quiet when the table is missing or
// the call fails: a lookup problem never locks anyone out.
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase.from("legal_acceptances").select("document, version").eq("profile_id", user.id);
  if (error) return NextResponse.json({ needs: [] }, { headers: { "cache-control": "no-store" } });
  return NextResponse.json({ needs: documentsNeedingAcceptance(data ?? []) }, { headers: { "cache-control": "no-store" } });
}
