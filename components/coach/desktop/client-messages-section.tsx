import { createServerClient } from "@/lib/supabase/server";
import { DirectMessageThread } from "@/components/messages/direct-message-thread";
import { loadDirectThread } from "@/lib/direct-thread";

// The Messages tab of one client's profile: the coach's conversation with that client, shown right below the tabs. A coach on a computer has no other message page (the old address redirects here);
// the phone keeps its own page. initialDraft is a drafted note from a check-in or reminder, for the coach to edit and send.
export async function ClientMessagesSection({ groupId, athleteId, viewerId, clientName, initialDraft = "" }: { groupId: string; athleteId: string; viewerId: string; clientName: string; initialDraft?: string }) {
  const supabase = await createServerClient();
  const [{ data: viewerProfile }, messages] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", viewerId).maybeSingle(),
    loadDirectThread(supabase, { groupId, viewerId, otherId: athleteId }),
  ]);
  return (
    <section>
      <div className="mb-2">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">Messages with {clientName}</h2>
      </div>
      <div className="max-w-[560px] h-[60vh] border border-steel/20">
        <DirectMessageThread
          groupId={groupId}
          viewerId={viewerId}
          viewerName={viewerProfile?.full_name ?? "You"}
          otherId={athleteId}
          otherName={clientName}
          initialMessages={messages}
          initialDraft={initialDraft}
        />
      </div>
    </section>
  );
}
