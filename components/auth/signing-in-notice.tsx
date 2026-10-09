// What /set-password and /confirm-email show while the link is being read, instead of a blank page: a person who tapped a link should see that
// something is happening.
export function SigningInNotice() {
  return (
    <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
      <p className="font-body text-sm text-steel" role="status">
        Signing you in…
      </p>
    </main>
  );
}
