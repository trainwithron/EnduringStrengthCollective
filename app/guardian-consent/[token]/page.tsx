import type { Metadata } from "next";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { coachNameFor, hashToken } from "@/lib/guardian-consent-server";
import { GuardianConsentForm } from "@/components/guardian/guardian-consent-form";

// A parent or guardian's private page (no account): the one-time link from their email is the whole access. Never listed by search engines. It shows what they would be agreeing to, lets them sign, and, once signed,
// lets them take their permission back.
export const metadata: Metadata = { title: "Permission to train", robots: { index: false, follow: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-10">
      <div className="max-w-xl mx-auto">{children}</div>
    </main>
  );
}

export default async function GuardianConsentPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const db = createServiceRoleClient();
  const { data } = token.length >= 20 && token.length <= 100 ? await db.from("guardian_consents").select("athlete_id, status, expires_at, guardian_name, relationship, signed_at").eq("token_hash", hashToken(token)).maybeSingle() : { data: null };
  const row = data as { athlete_id: string; status: string; expires_at: string; guardian_name: string | null; relationship: string | null; signed_at: string | null } | null;

  if (!row) {
    return (
      <Shell>
        <h1 className="font-display font-bold text-3xl uppercase leading-none">This link isn&apos;t valid</h1>
        <p className="font-body text-sm text-steel mt-3">Check that you opened the whole link from the email. If it still does not work, ask the person who asked you to send a new request.</p>
      </Shell>
    );
  }

  const [{ data: profile }, coach] = await Promise.all([db.from("profiles").select("full_name").eq("id", row.athlete_id).maybeSingle(), coachNameFor(db, row.athlete_id)]);
  const childName = (profile as { full_name?: string | null } | null)?.full_name?.trim() || "your child";

  if (row.status === "withdrawn") {
    return (
      <Shell>
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Permission withdrawn</h1>
        <p className="font-body text-sm text-steel mt-3">You took back your permission for {childName}. They can&apos;t use the app until a parent or guardian gives permission again.</p>
      </Shell>
    );
  }
  if (row.status === "replaced" || (row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now())) {
    return (
      <Shell>
        <h1 className="font-display font-bold text-3xl uppercase leading-none">This link has expired</h1>
        <p className="font-body text-sm text-steel mt-3">A newer request was sent, or this one ran out of time. Open the newest email, or ask for a new request.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <GuardianConsentForm token={token} childName={childName} coachName={coach} signed={row.status === "signed" ? { name: row.guardian_name ?? "", relationship: row.relationship ?? "", at: row.signed_at ?? "" } : null} />
    </Shell>
  );
}
