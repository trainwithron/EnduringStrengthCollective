import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CoachMobileShell } from "@/components/coach/mobile/coach-mobile-shell";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { prefersAthleteStyleView } from "@/lib/pwa-server";

interface ConversationRow {
  otherId: string;
  fullName: string;
  avatarUrl: string | null;
  lastBody: string | null;
  lastAt: string | null;
  unreadCount: number;
}

// Coach<->Athlete DM (athlete_social_dm_video_chat_scoping memory) — this
// page is the conversation list; one party's messages, one row per other
// participant. A coach sees every athlete in the roster; an athlete (or a
// coach viewing as one) sees every coach on staff — usually exactly one,
// in which case this redirects straight into that thread rather than
// making someone click through a list of one.
function buildConversations(
  others: { id: string; fullName: string; avatarUrl: string | null }[],
  messages: { sender_id: string; recipient_id: string; body: string; created_at: string; read_at: string | null }[],
  viewerId: string
): ConversationRow[] {
  const byOther = new Map<string, ConversationRow>();
  for (const o of others) {
    byOther.set(o.id, {
      otherId: o.id,
      fullName: o.fullName,
      avatarUrl: o.avatarUrl,
      lastBody: null,
      lastAt: null,
      unreadCount: 0,
    });
  }
  for (const m of messages) {
    const otherId = m.sender_id === viewerId ? m.recipient_id : m.sender_id;
    const row = byOther.get(otherId);
    if (!row) continue;
    if (!row.lastAt || m.created_at > row.lastAt) {
      row.lastAt = m.created_at;
      row.lastBody = m.body;
    }
    if (m.recipient_id === viewerId && !m.read_at) row.unreadCount++;
  }
  return Array.from(byOther.values()).sort((a, b) => {
    if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
    if (a.lastAt && b.lastAt) return b.lastAt.localeCompare(a.lastAt);
    if (a.lastAt) return -1;
    if (b.lastAt) return 1;
    return a.fullName.localeCompare(b.fullName);
  });
}

export default async function MessagesPage(props: { params: Promise<{ groupId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  const isCoach = membership?.role === "coach";

  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const isActingAsOther = effective.isActingAsOther;
  const showMobileView = isActingAsOther || !isCoach || (await prefersAthleteStyleView());

  // Which role's conversation list to show is about the VIEWER's real
  // role in this messaging pair, not which chrome renders it — a coach
  // opening the installed mobile app on their own phone (not acting as a
  // client) still wants their roster of athletes, just in mobile chrome
  // instead of the desktop shell. `showMobileView` only decides chrome
  // below; this decides data.
  const viewerIsCoach = isCoach && !isActingAsOther;

  if (viewerIsCoach) {
    const [{ data: group }, { data: roster }, { data: messages }] = await Promise.all([
      supabase.from("groups").select("name").eq("id", params.groupId).single(),
      supabase
        .from("group_memberships")
        .select("profile_id, profiles ( full_name, avatar_url )")
        .eq("group_id", params.groupId)
        .eq("role", "athlete"),
      supabase
        .from("direct_messages")
        .select("sender_id, recipient_id, body, created_at, read_at")
        .eq("group_id", params.groupId)
        .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`),
    ]);

    const others = (roster ?? []).map((r: any) => ({
      id: r.profile_id,
      fullName: r.profiles?.full_name ?? "Athlete",
      avatarUrl: r.profiles?.avatar_url ?? null,
    }));
    const conversations = buildConversations(others, messages ?? [], user.id);

    const list = (
      <div className={showMobileView ? "px-5 pt-4 space-y-1" : "max-w-[560px] space-y-1"}>
        {conversations.length === 0 && (
          <p className="font-body text-sm text-steel">No athletes to message yet.</p>
        )}
        {conversations.map((c) => (
          <ConversationLink key={c.otherId} groupId={params.groupId} conversation={c} />
        ))}
      </div>
    );

    if (!showMobileView) {
      return (
        <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="messages">
          <div className="pb-6 border-b border-steel/20 mb-6">
            <h1 className="font-display font-bold text-3xl uppercase leading-none">Messages</h1>
          </div>
          {list}
        </CoachDesktopShell>
      );
    }

    return (
      <main className="min-h-screen bg-graphite text-chalk font-body">
        <CoachMobileShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} activeOverride="messages">
          <div className="pb-24">
            <header className="px-5 pt-8 pb-6 border-b border-steel/20">
              <h1 className="font-display font-bold text-3xl uppercase leading-none">Messages</h1>
            </header>
            {list}
          </div>
        </CoachMobileShell>
      </main>
    );
  }

  // Athlete-experience branch — the real athlete, or a coach acting as
  // one. Always mobile chrome; this is never the coach's own desktop
  // experience.
  const athleteId = effective.athleteId;
  const [{ data: coaches }, { data: messages }, { data: viewedProfile }] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("profile_id, profiles ( full_name, avatar_url )")
      .eq("group_id", params.groupId)
      .eq("role", "coach"),
    supabase
      .from("direct_messages")
      .select("sender_id, recipient_id, body, created_at, read_at")
      .eq("group_id", params.groupId)
      .or(`sender_id.eq.${athleteId},recipient_id.eq.${athleteId}`),
    isActingAsOther
      ? supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const others = (coaches ?? []).map((r: any) => ({
    id: r.profile_id,
    fullName: r.profiles?.full_name ?? "Coach",
    avatarUrl: r.profiles?.avatar_url ?? null,
  }));

  // Exactly one coach (the overwhelmingly common case) — skip the list
  // entirely and land straight in that one real thread.
  if (others.length === 1) {
    redirect(`/groups/${params.groupId}/messages/${others[0].id}`);
  }

  const conversations = buildConversations(others, messages ?? [], athleteId);

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-28">
      {isActingAsOther && (
        <ActingAsBanner athleteFullName={viewedProfile?.full_name ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to group
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">Messages</h1>
      </header>
      <div className="px-5 pt-4 space-y-1">
        {conversations.length === 0 && (
          <p className="font-body text-sm text-steel">No coach to message yet.</p>
        )}
        {conversations.map((c) => (
          <ConversationLink key={c.otherId} groupId={params.groupId} conversation={c} />
        ))}
      </div>
      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}

function ConversationLink({ groupId, conversation }: { groupId: string; conversation: ConversationRow }) {
  return (
    <Link
      href={`/groups/${groupId}/messages/${conversation.otherId}`}
      className="flex items-center gap-3 py-3 border-b border-steel/10 last:border-b-0"
    >
      <Avatar name={conversation.fullName} url={conversation.avatarUrl} />
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-medium truncate">{conversation.fullName}</p>
        <p className="font-body text-xs text-steel truncate">
          {conversation.lastBody ?? "No messages yet"}
        </p>
      </div>
      {conversation.unreadCount > 0 && (
        <span className="h-5 min-w-[20px] px-1 rounded-full bg-rust text-graphite font-body text-[10px] font-bold flex items-center justify-center shrink-0">
          {conversation.unreadCount > 9 ? "9+" : conversation.unreadCount}
        </span>
      )}
    </Link>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="w-10 h-10 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0">
      <span className="font-display text-xs">{initials}</span>
    </div>
  );
}
