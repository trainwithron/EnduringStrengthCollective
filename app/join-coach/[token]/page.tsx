import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { JOIN_LINK_COLUMNS, joinLinkState, parseJoinLinkToken, type JoinLinkRow } from "@/lib/coach-join-link";
import { JoinCoachForm } from "@/components/auth/join-coach-form";

export const metadata = { title: "Join" };
export const dynamic = "force-dynamic";

const ROLE_PHRASE: Record<string, string> = { admin: "an admin", coach: "a coach", front_desk: "front desk staff" };

// The page an invitation link opens. READ ONLY: it looks the link up and shows who invited whom to what; it never signs anyone in, never changes the link and never submits anything by itself, so an email scanner, a message
// preview or an administrator opening it uses nothing up. The link is used up only when the invited person presses the button on this page after choosing a password (app/api/coaches/join).
export default async function JoinCoachPage(props: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await props.params;
  let token = rawToken;
  try {
    token = decodeURIComponent(rawToken);
  } catch {
    // left as it came
  }
  const id = parseJoinLinkToken(token);
  const notice = (heading: string, body: string) => (
    <main className="min-h-screen flex items-center justify-center px-6 text-center">
      <div>
        <h1 className="font-display uppercase text-2xl font-bold">{heading}</h1>
        <p className="font-body text-steel text-sm mt-2 max-w-sm">{body}</p>
        <a href="/login" className="inline-flex items-center justify-center h-11 px-6 mt-5 bg-rust text-graphite font-body text-sm font-medium">
          Sign in
        </a>
      </div>
    </main>
  );
  if (!id) return notice("That link isn't valid", "Ask whoever invited you to send it again.");

  const db = createServiceRoleClient();
  const { data, error } = await db.from("coach_join_links").select(JOIN_LINK_COLUMNS).eq("id", id).maybeSingle();
  if (error) return notice("Couldn't open that link", "Try again in a few minutes.");
  const row = data as JoinLinkRow | null;
  if (!row) return notice("That link isn't valid", "Ask whoever invited you to send it again.");
  const state = joinLinkState(row);
  if (state === "used") return notice("That link was already used", "If you chose a password, sign in with it. If you did not, ask whoever invited you to send it again.");
  if (state === "revoked") return notice("That invitation was cancelled", "Ask whoever invited you to send it again.");
  if (state === "expired") return notice("That link has expired", "Ask whoever invited you to send it again; it will be the same link, made fresh.");

  const [{ data: org }, { data: member }, { data: invitee }, { data: inviter }, { data: userData }] = await Promise.all([
    db.from("organizations").select("name").eq("id", row.organization_id).maybeSingle(),
    db.from("organization_memberships").select("role").eq("organization_id", row.organization_id).eq("profile_id", row.profile_id).maybeSingle(),
    db.from("profiles").select("full_name").eq("id", row.profile_id).maybeSingle(),
    row.created_by ? db.from("profiles").select("full_name").eq("id", row.created_by).maybeSingle() : Promise.resolve({ data: null }),
    db.auth.admin.getUserById(row.profile_id),
  ]);
  const email = userData?.user?.email ?? "";
  const masked = email ? email.replace(/^(.).*(@.*)$/, "$1***$2") : "";
  return (
    <JoinCoachForm
      token={token}
      orgName={(org as { name?: string } | null)?.name ?? "an organization"}
      rolePhrase={ROLE_PHRASE[(member as { role?: string } | null)?.role ?? "front_desk"] ?? "a coach"}
      inviterName={(inviter as { full_name?: string | null } | null)?.full_name ?? null}
      inviteeName={(invitee as { full_name?: string | null } | null)?.full_name ?? ""}
      maskedEmail={masked}
      kind={row.kind}
    />
  );
}
