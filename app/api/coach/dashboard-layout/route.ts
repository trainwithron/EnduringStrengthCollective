import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

// Persists a coach's Home dashboard tile arrangement — a real DB row,
// per-coach (not per-org like word-swap), since this is personal taste
// that needs to follow a coach across devices, not a localStorage-only
// convenience (coach_dashboard_redesign_scoping.md).
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const tileOrder = Array.isArray(body?.tileOrder) ? body.tileOrder : undefined;
  const hiddenTiles = Array.isArray(body?.hiddenTiles) ? body.hiddenTiles : undefined;
  const tileMetricOverrides =
    body?.tileMetricOverrides && typeof body.tileMetricOverrides === "object" ? body.tileMetricOverrides : undefined;
  // "The Spot" widget rail (coach_only_widget_hub_the_spot.md) — a second,
  // independent show/hide/reorder preference living on this same
  // per-coach row, not the Home dashboard's own tiles above.
  const spotWidgetOrder = Array.isArray(body?.spotWidgetOrder) ? body.spotWidgetOrder : undefined;
  const spotHiddenWidgets = Array.isArray(body?.spotHiddenWidgets) ? body.spotHiddenWidgets : undefined;

  const patch: Record<string, unknown> = { coach_id: user.id, updated_at: new Date().toISOString() };
  if (tileOrder) patch.tile_order = tileOrder;
  if (hiddenTiles) patch.hidden_tiles = hiddenTiles;
  if (tileMetricOverrides) patch.tile_metric_overrides = tileMetricOverrides;
  if (spotWidgetOrder) patch.spot_widget_order = spotWidgetOrder;
  if (spotHiddenWidgets) patch.spot_hidden_widgets = spotHiddenWidgets;

  const { error } = await supabase.from("coach_dashboard_layout").upsert(patch, { onConflict: "coach_id" });

  if (error) {
    return NextResponse.json({ error: "Couldn't save your layout — try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
