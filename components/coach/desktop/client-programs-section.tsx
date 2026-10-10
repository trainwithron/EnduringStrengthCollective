import Link from "next/link";
import type { ReactNode } from "react";
import { createServerClient } from "@/lib/supabase/server";
import { programsHrefForClient } from "@/lib/programs-scope";
import { ClientProgramMenu } from "@/components/coach/client-program-menu";
import { RemovedPrograms } from "@/components/coach/removed-programs";

// The Programs tab of one client's profile: the programs made for this client (their own copies), the active one first, each opening the builder. Assigning one
// is the "Assign program" button above the list.
export async function ClientProgramsSection({ groupId, athleteId, actions }: { groupId: string; athleteId: string; actions?: ReactNode }) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("programs")
    .select("id, name, is_active, ai_draft, created_at, profiles!programs_athlete_id_fkey ( full_name )")
    .eq("group_id", groupId)
    .eq("athlete_id", athleteId)
    .is("archived_at", null)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  // Programs taken off this profile (kept, hidden from the client): a quiet fold at the bottom with Put back.
  const { data: removedData } = await supabase
    .from("programs")
    .select("id, name")
    .eq("group_id", groupId)
    .eq("athlete_id", athleteId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(50);
  const removed = (removedData ?? []) as { id: string; name: string }[];
  const programs = (data ?? []) as unknown as { id: string; name: string; is_active: boolean; ai_draft?: boolean; created_at: string; profiles?: { full_name?: string | null } | null }[];
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
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">Programs</h2>
        {/* The one way into the Programs page scoped to this client; the page says it is scoped and offers everything. */}
        <Link href={programsHrefForClient(athleteId, groupId)} className="font-body text-xs text-steel hover:text-chalk min-h-11 sm:min-h-0 inline-flex items-center">
          Open on the Programs page
        </Link>
      </div>
      {actions}
      {shared && (
        <Link href={`/groups/${groupId}/programs/${shared.id}`} className="flex items-center justify-between gap-3 py-2.5 px-1 mb-2 border-y border-steel/15 hover:bg-surface/60">
          <span className="font-body text-sm text-chalk truncate">{shared.name}</span>
          <span className="font-body text-xs shrink-0 text-steel">Shared with the group{programs.length === 0 ? " · what they follow now" : ""}</span>
        </Link>
      )}
      {programs.length === 0 ? (
        shared ? null : <p className="font-body text-sm text-steel">No program made for them yet. Use Assign program above.</p>
      ) : (
        <ul className="divide-y divide-steel/15 border-y border-steel/15">
          {programs.map((p) => (
            <li key={p.id} className="flex items-center">
              <Link href={`/groups/${groupId}/programs/${p.id}`} className="flex flex-1 min-w-0 items-center justify-between gap-3 py-2.5 px-1 hover:bg-surface/60">
                <span className="font-body text-sm text-chalk truncate">{p.name}</span>
                <span className={`font-body text-xs shrink-0 ${p.ai_draft ? "text-rust" : p.is_active ? "text-positive" : "text-steel"}`}>{p.ai_draft ? "AI draft" : p.is_active ? "Active" : "Not active"}</span>
              </Link>
              <ClientProgramMenu programId={p.id} programName={p.name} clientName={p.profiles?.full_name ?? ""} isActive={p.is_active} aiDraft={!!p.ai_draft} />
            </li>
          ))}
        </ul>
      )}
      <RemovedPrograms programs={removed} />
    </section>
  );
}
