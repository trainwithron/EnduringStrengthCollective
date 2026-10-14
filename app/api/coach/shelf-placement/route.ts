import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { groupBelongsToCoach } from "@/lib/package-group-access";
import { isAudience } from "@/lib/shelf";

// Where one of the coach's packages or Pro Shop cards shows, and who sees it inside the app. Plain settings, no Stripe: saved as the coach (row policies already limit a coach to their own rows); the one
// group a card can be limited to must be a team or social group the coach coaches.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const target = body.target === "package" || body.target === "link" ? (body.target as "package" | "link") : null;
  const id = typeof body.id === "string" ? body.id : "";
  if (!target || !id) return NextResponse.json({ error: "Missing item." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.audience !== undefined) {
    if (!isAudience(body.audience)) return NextResponse.json({ error: "Pick who sees it." }, { status: 400 });
    const groupId = typeof body.audienceGroupId === "string" && body.audienceGroupId ? body.audienceGroupId : null;
    if (body.audience === "one_group") {
      if (!groupId) return NextResponse.json({ error: "Pick the group." }, { status: 400 });
      if (!(await groupBelongsToCoach(supabase, user.id, groupId))) return NextResponse.json({ error: "That group is not one of yours." }, { status: 400 });
    }
    patch.audience = body.audience;
    patch.audience_group_id = body.audience === "one_group" ? groupId : null;
  }
  if (target === "package") {
    if (typeof body.showOnHome === "boolean") patch.show_on_home = body.showOnHome;
    if (typeof body.showInProShop === "boolean") patch.show_in_pro_shop = body.showInProShop;
    if (typeof body.buyerJoinsSpace === "boolean") patch.buyer_joins_space = body.buyerJoinsSpace;
  } else if (typeof body.showOnPublic === "boolean") {
    patch.show_on_public = body.showOnPublic;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const table = target === "package" ? "coach_packages" : "pro_shop_links";
  const { data, error } = await supabase.from(table).update(patch).eq("id", id).eq("coach_id", user.id).select("id");
  if (error || !data || data.length === 0) return NextResponse.json({ error: "That didn't save. Nothing was changed." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
