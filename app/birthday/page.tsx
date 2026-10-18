import { redirect } from "next/navigation";
import { safePushPath } from "@/lib/push-url";
import { createServerClient } from "@/lib/supabase/server";
import { loadDobGate } from "@/lib/dob-gate";
import { BirthdayForm } from "@/components/intake/birthday-form";
import { SignOutButton } from "@/components/group/sign-out-button";

export const metadata = { title: "Birthday" };

// The one-field date-of-birth step. Only a client without a date of birth on file, or a child under 13 waiting on a parent's consent, ever stays on this page; everyone else is sent on.
export default async function BirthdayPage(props: { searchParams: Promise<{ next?: string }> }) {
  const search = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const facts = await loadDobGate(supabase, user.id);
  const next = search.next && safePushPath(search.next) !== "/" ? safePushPath(search.next) : facts.groupId ? `/groups/${facts.groupId}` : "/";
  if (facts.gate === "ok" || !facts.groupId) redirect(next);

  const { data: coachRow } = await supabase.from("group_memberships").select("profiles ( full_name )").eq("group_id", facts.groupId).eq("role", "coach").limit(1).maybeSingle();
  const coachName = (coachRow as { profiles?: { full_name?: string | null } | null } | null)?.profiles?.full_name ?? null;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-10">
      <div className="max-w-lg mx-auto">
        <div className="flex justify-end mb-4">
          <SignOutButton />
        </div>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mb-2">One quick thing</h1>
        <p className="font-body text-sm text-steel mb-8">What&apos;s your date of birth? We ask once so your coach and the app handle your information correctly.</p>
        <BirthdayForm groupId={facts.groupId} coachName={coachName} initialDateOfBirth={facts.dateOfBirth ?? facts.profileBirthday} alreadySaved={!!facts.dateOfBirth} consentVerified={facts.consentVerified} nextUrl={next} />
      </div>
    </main>
  );
}
