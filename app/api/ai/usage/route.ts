import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAiUsage } from "@/lib/coach-credits";
import { coachBudgetMessage, meterLine, type BudgetStatus } from "@/lib/ai-budget";
import { getCoachBudgetStatus, topUpInfo } from "@/lib/ai-budget-server";

// Feeds the coach-facing usage meter: how much of this month's included
// AI generations (per 100-client step) a coach has used, and the one simple
// monthly AI budget meter ("AI this month: 62% used") with the plain-spoken
// message at about 80 percent and when it is used up. Read-only, and
// always the signed-in coach's own numbers.
export interface AiBudgetView {
  status: BudgetStatus;
  line: string;
  // Null while the coach is under about 80 percent (nothing to say yet).
  message: string | null;
  // False while billing is off: the screen then shows no buy button.
  canBuy: boolean;
}

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const usage = await getAiUsage(supabase, user.id);

  // The budget is worked out with the service role (the usage log is not readable from the app). If that is not available or the database does not have the budget helpers yet,
  // the response simply has no budget and the screen shows nothing extra.
  let budget: AiBudgetView | null = null;
  try {
    const status = await getCoachBudgetStatus(createServiceRoleClient(), user.id);
    if (status) {
      const top = topUpInfo();
      budget = {
        status,
        line: meterLine(status),
        message: status.level === "low" || status.level === "out" ? coachBudgetMessage(status.level, top) : null,
        canBuy: top.available,
      };
    }
  } catch {
    budget = null;
  }
  return NextResponse.json({ ...usage, budget });
}
