import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { syncTier1ExpertReports } from "@/lib/spotter-tier1-sync";
import { synthesizeCornerstone } from "@/lib/spotter-cornerstone-synthesis";
import { synthesizeOverarching } from "@/lib/spotter-overarching-synthesis";
import type { Cornerstone, SpotterExpertReport } from "@/lib/spotter-expert-report";

// 3-layer Spotter framework
// (two_layer_spotter_framework_architecture_research_sept19.md) — once
// daily per coach: sync real Tier-1 findings, roll them up per
// cornerstone (Tier 2), then roll every cornerstone's output into one
// overarching picture (Tier 3). Same CRON_SECRET/service-role shape as
// every other cron in this app. Deliberately separate from
// /api/cron/coach-briefing — see spotter-overarching-synthesis.ts's own
// header comment for why this doesn't replace that route's real, live
// generation path in this pass.
const CORNERSTONES: Cornerstone[] = ["business", "programming", "nutrition", "calendar", "habit_recovery"];

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: coachMemberships } = await supabase
    .from("group_memberships")
    .select("profile_id, group_id")
    .eq("role", "coach");

  const groupIdsByCoach = new Map<string, string[]>();
  for (const row of coachMemberships ?? []) {
    const list = groupIdsByCoach.get(row.profile_id) ?? [];
    list.push(row.group_id);
    groupIdsByCoach.set(row.profile_id, list);
  }

  const results: { coachId: string; tier1Count: number; tier2Count: number; tier3Count: number }[] = [];

  for (const [coachId, groupIds] of groupIdsByCoach) {
    const { data: orgMembership } = await supabase
      .from("organization_memberships")
      .select("organization_id")
      .eq("profile_id", coachId)
      .maybeSingle();

    const tier1Reports = await syncTier1ExpertReports(supabase, {
      coachId,
      groupIds,
      organizationId: orgMembership?.organization_id ?? null,
    });

    const tier1WithIds = tier1Reports.filter((r): r is SpotterExpertReport & { id: string } => !!r.id);
    const tier1ByCornerstone = new Map<Cornerstone, SpotterExpertReport[]>();
    for (const r of tier1WithIds) {
      const list = tier1ByCornerstone.get(r.cornerstone) ?? [];
      list.push(r);
      tier1ByCornerstone.set(r.cornerstone, list);
    }

    const allTier2: SpotterExpertReport[] = [];
    for (const cornerstone of CORNERSTONES) {
      const cornerstoneReports = tier1ByCornerstone.get(cornerstone) ?? [];
      const tier2 = await synthesizeCornerstone(supabase, { coachId, cornerstone, tier1Reports: cornerstoneReports });
      allTier2.push(...tier2);
    }

    let tier2Inserted: SpotterExpertReport[] = [];
    if (allTier2.length > 0) {
      const { data: inserted } = await supabase
        .from("spotter_expert_reports")
        .upsert(
          allTier2.map((r) => ({
            coach_id: r.coachId,
            spotter_kind: r.spotterKind,
            tier: r.tier,
            cornerstone: r.cornerstone,
            rolled_up_from: r.rolledUpFrom,
            subject_type: r.subjectType,
            subject_id: r.subjectId,
            finding: r.finding,
            evidence_basis: r.evidenceBasis,
            severity: r.severity,
            time_window_start: r.timeWindowStart,
            time_window_end: r.timeWindowEnd,
            numeric_values: r.numericValues,
            dismissal_key: r.dismissalKey,
          })),
          { onConflict: "coach_id,dismissal_key,tier,report_date" }
        )
        .select("id, dismissal_key");
      const idByKey = new Map((inserted ?? []).map((row) => [row.dismissal_key, row.id]));
      tier2Inserted = allTier2.map((r) => ({ ...r, id: idByKey.get(r.dismissalKey) }));
    }

    const tier2WithIds = tier2Inserted.filter((r): r is SpotterExpertReport & { id: string } => !!r.id);
    const tier3 = await synthesizeOverarching(supabase, { coachId, tier2Reports: tier2WithIds });
    if (tier3.length > 0) {
      await supabase.from("spotter_expert_reports").upsert(
        tier3.map((r) => ({
          coach_id: r.coachId,
          spotter_kind: r.spotterKind,
          tier: r.tier,
          cornerstone: r.cornerstone,
          rolled_up_from: r.rolledUpFrom,
          subject_type: r.subjectType,
          subject_id: r.subjectId,
          finding: r.finding,
          evidence_basis: r.evidenceBasis,
          severity: r.severity,
          time_window_start: r.timeWindowStart,
          time_window_end: r.timeWindowEnd,
          numeric_values: r.numericValues,
          dismissal_key: r.dismissalKey,
        })),
        { onConflict: "coach_id,dismissal_key,tier,report_date" }
      );
    }

    results.push({ coachId, tier1Count: tier1Reports.length, tier2Count: tier2Inserted.length, tier3Count: tier3.length });
  }

  return NextResponse.json({ ok: true, results });
}
