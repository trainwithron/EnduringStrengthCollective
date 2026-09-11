import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { SupportThread, type SupportMessageRow } from "@/components/coach/desktop/support-thread";

export default async function AdminSupportPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_platform_admin) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">You don&apos;t have access to this page.</p>
      </main>
    );
  }

  const { data: requestRows } = await supabase
    .from("support_requests")
    .select(
      `id, subject, status, created_at,
       organizations ( name ),
       profiles!support_requests_coach_id_fkey ( full_name ),
       support_messages ( id, author_id, body, created_at, profiles ( full_name ) )`
    )
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  const requests = (requestRows ?? []).map((r: any) => ({
    id: r.id,
    subject: r.subject,
    status: r.status as "open" | "resolved",
    orgName: r.organizations?.name ?? "Unknown org",
    coachName: r.profiles?.full_name ?? "Unknown coach",
    createdAt: r.created_at,
    messages: (r.support_messages ?? [])
      .slice()
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(
        (m: any): SupportMessageRow => ({
          id: m.id,
          authorId: m.author_id,
          authorName: m.author_id === user.id ? "You" : m.profiles?.full_name ?? "Coach",
          body: m.body,
          createdAt: m.created_at,
        })
      ),
  }));

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-6 py-8 md:px-10">
      <div className="max-w-3xl mx-auto">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Support Inbox</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            Every coach support request across the platform — visible only to you.
          </p>
        </div>

        <div className="space-y-4">
          {requests.map((r) => (
            <div key={r.id}>
              <p className="font-body text-xs text-steel mb-1">
                {r.orgName} · {r.coachName} · {new Date(r.createdAt).toLocaleDateString()}
              </p>
              <SupportThread
                requestId={r.id}
                subject={r.subject}
                status={r.status}
                messages={r.messages}
                viewerId={user.id}
                canManage={true}
              />
            </div>
          ))}
          {requests.length === 0 && (
            <p className="font-body text-sm text-steel">No support requests yet.</p>
          )}
        </div>

        <p className="font-body text-xs text-steel mt-8">
          <Link href="/" className="text-rust">
            ← Back home
          </Link>
        </p>
      </div>
    </main>
  );
}
