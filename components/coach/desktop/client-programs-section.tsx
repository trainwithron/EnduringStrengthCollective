import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";

// The Programs tab of one client's profile: the programs made for this client (their own copies), the active one first, each opening the builder. Assigning one
// is the "Programming" menu at the top of the profile.
export async function ClientProgramsSection({ groupId, athleteId }: { groupId: string; athleteId: string }) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("programs")
    .select("id, name, is_active, created_at")
    .eq("group_id", groupId)
    .eq("athlete_id", athleteId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  const programs = (data ?? []) as { id: string; name: string; is_active: boolean; created_at: string }[];
  // A client with no program of their own follows the group's shared active program: show it, labelled, instead of "none".
  const { data: sharedRow } = await supabase
    .from("programs")
    .select("id, name")
    .eq("group_id", groupId)
    .is("athlete_id", null)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const shared = (sharedRow ?? null) as { id: string; name: string } | null;

  return (
    <section>
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Programs</h2>
      {shared && (
        <Link href={`/groups/${groupId}/programs/${shared.id}`} className="flex items-center justify-between gap-3 py-2.5 px-1 mb-2 border-y border-steel/15 hover:bg-surface/60">
          <span className="font-body text-sm text-chalk truncate">{shared.name}</span>
          <span className="font-body text-xs shrink-0 text-steel">Shared with the group{programs.length === 0 ? " · what they follow now" : ""}</span>
        </Link>
      )}
      {programs.length === 0 ? (
        shared ? null : <p className="font-body text-sm text-steel">No program made for them yet. Use Programming at the top to assign one.</p>
      ) : (
        <ul className="divide-y divide-steel/15 border-y border-steel/15">
          {programs.map((p) => (
            <li key={p.id}>
              <Link href={`/groups/${groupId}/programs/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 px-1 hover:bg-surface/60">
                <span className="font-body text-sm text-chalk truncate">{p.name}</span>
                <span className={`font-body text-xs shrink-0 ${p.is_active ? "text-positive" : "text-steel"}`}>{p.is_active ? "Active" : "Not active"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
