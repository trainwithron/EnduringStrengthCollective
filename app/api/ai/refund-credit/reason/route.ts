import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// The optional second step after a refund already fired — attaches a
// reason to the coach's OWN already-created refund row. Separate route
// (not folded into the main refund call) so the refund itself never
// has to wait on this.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json();
  const { referenceId, reason } = body as { referenceId?: string; reason?: string };
  if (!referenceId || !reason) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  const { data: attached, error } = await supabase.rpc("attach_refund_reason", {
    p_reference_id: referenceId,
    p_reason: reason,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ attached });
}
