import type { Metadata } from "next";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { describeEmailChange } from "@/lib/email-change";
import { EmailChangeButtons } from "@/components/auth/email-change-buttons";

export const metadata: Metadata = { title: "Sign-in email", robots: { index: false } };
export const dynamic = "force-dynamic";

// Where the link in a sign-in email change lands. Opening it changes nothing (email scanners open links); the change happens only when the person presses the button.
export default async function EmailChangePage({ searchParams }: { searchParams: Promise<{ token?: string; action?: string }> }) {
  const { token = "", action = "confirm" } = await searchParams;
  const state = token ? await describeEmailChange(createServiceRoleClient(), token) : { state: "unknown" as const };
  const mode = action === "cancel" ? "cancel" : "confirm";
  const text: Record<string, string> = {
    unknown: "That link is not valid.",
    expired: "That link has expired. Ask your coach to send it again.",
    used: "That link was already used.",
    cancelled: "That change was cancelled.",
  };
  return (
    <main className="min-h-screen bg-graphite text-chalk px-5 py-12 max-w-md mx-auto">
      <h1 className="font-display font-bold text-3xl uppercase leading-none">Sign-in email</h1>
      {state.state === "waiting" ? (
        <>
          <p className="font-body text-sm text-chalk mt-4">
            {mode === "confirm"
              ? `Your coach asked to change the email you sign in with to ${state.newEmail}. Confirm only if that is your address and you want this change.`
              : `A change of your sign-in email to ${state.newEmail} is waiting. Nothing has changed. Cancel it if you did not expect it.`}
          </p>
          <EmailChangeButtons token={token} mode={mode} />
        </>
      ) : (
        <p className="font-body text-sm text-steel mt-4">{text[state.state] ?? text.unknown}</p>
      )}
    </main>
  );
}
