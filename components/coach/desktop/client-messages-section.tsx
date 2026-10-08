import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { DirectMessageThread } from "@/components/messages/direct-message-thread";
import { loadDirectThread } from "@/lib/direct-thread";

// The Messages tab of one client's profile: the same conversation as the full Messages page, shown right below the tabs. The full page stays for links and the phone.
export async function ClientMessagesSection({ groupId, athleteId, viewerId, clientName }: { groupId: string; athleteId: string; viewerId: string; clientName: string }) {
  const supabase = await createServerClient();
  const [{ data: viewerProfile }, messages] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", viewerId).maybeSingle(),
    loadDirectThread(supabase, { groupId, viewerId, otherId: athleteId }),
  ]);
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel">Messages with {clientName}</h2>
        <Link href={`/groups/${groupId}/messages/${athleteId}`} className="font-body text-xs text-steel hover:text-chalk">
          Open on its own page
        </Link>
      </div>
      <div className="max-w-[560px] h-[60vh] border border-steel/20">
        <DirectMessageThread
          groupId={groupId}
          viewerId={viewerId}
          viewerName={viewerProfile?.full_name ?? "You"}
          otherId={athleteId}
          otherName={clientName}
          initialMessages={messages}
          initialDraft=""
        />
      </div>
    </section>
  );
}
