import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { QuietClientNudgeButton } from "@/components/coach/quiet-client-nudge-button";
import { loadQuietInChat, QUIET_CHAT_DAYS } from "@/lib/quiet-chat";

// Quiet in chat (Ron, Nov 20: R3), in the stack below Needs you: one line per client who hasn't replied in chat for 14+ days while the coach has messaged them, the longest quiet first,
// each with "Message {name}" (sent inside Spotlight, the draft editable first). Shows nothing when nobody is quiet, or when the read failed (Needs you then says it couldn't check everything).
// The same read as the Needs you card (one read for both).
export async function QuietInChatPanel({ coachId, coachName, groupIds, now }: { coachId: string; coachName: string; groupIds: string[]; now: Date }) {
  const supabase = await createServerClient();
  const { quiet, names, failed } = await loadQuietInChat(supabase, coachId, [...groupIds].sort().join(","), now.toISOString());
  const rows = quiet.filter((q) => names.has(q.athleteId)).slice(0, 25);
  if (failed || rows.length === 0) return null;
  return (
    <section className="border border-steel/25 bg-surface p-4 mb-6" aria-label="Quiet in chat" id="quiet-in-chat">
      <h2 className="font-body text-[15px] font-semibold text-chalk">Quiet in chat ({rows.length})</h2>
      <p className="font-body text-xs text-steel mt-0.5 mb-3">No reply to you in {QUIET_CHAT_DAYS}+ days, though you&apos;ve messaged them since.</p>
      <ul className="divide-y divide-steel/15">
        {rows.map((q) => {
          const name = names.get(q.athleteId)!;
          return (
            <li key={q.athleteId} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1" data-quiet-chat-row>
              <Link prefetch={false} href={`/groups/${q.groupId}/athletes/${q.athleteId}`} className="font-body text-sm text-chalk flex-1 min-w-[8rem] truncate hover:underline">
                {name}
              </Link>
              <span className="font-body text-xs text-steel tabular-nums">{q.days} days</span>
              <QuietClientNudgeButton athleteId={q.athleteId} athleteFirstName={name.split(" ")[0]} groupId={q.groupId} coachId={coachId} coachName={coachName} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
