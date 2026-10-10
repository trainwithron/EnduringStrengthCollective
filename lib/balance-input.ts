import type { SupabaseClient } from "@supabase/supabase-js";

// A number typed straight into the "Sessions left" control: a whole number from 0 to 500, or null (blank, text, a minus sign, a decimal, too big), in which
// case the control just goes back to what it showed.
export function parseBalanceInput(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 500 ? n : null;
}

// Sets a client's balance to a number, through the same database function (and ledger note trail) the "Set balance" box uses; until that function exists it changes
// the balance by the difference. Returns the new balance, or null when it did not save.
export async function setClientBalance(supabase: SupabaseClient, opts: { athleteId: string; groupId: string; target: number; current: number }): Promise<number | null> {
  const { data, error } = await supabase.rpc("set_session_balance", { p_athlete_id: opts.athleteId, p_group_id: opts.groupId, p_target: opts.target, p_note: null });
  if (!error) return typeof data === "number" ? data : opts.target;
  if (/could not find the function|does not exist/i.test(error.message)) {
    const { data: newBalance, error: fallbackError } = await supabase.rpc("adjust_session_credits", { p_athlete_id: opts.athleteId, p_group_id: opts.groupId, p_delta: opts.target - opts.current });
    if (fallbackError) return null;
    return typeof newBalance === "number" ? newBalance : opts.target;
  }
  return null;
}
