import { isEmbeddedRequest } from "@/lib/embedded-request";
import { createServerClient } from "@/lib/supabase/server";
import { EmbeddedProvider } from "@/components/shared/embedded-context";
import { WorkspaceHost } from "@/components/coach/workspace/workspace-host";
import { OrgThemeSync } from "@/components/shared/org-theme-sync";
import { PendingEmailChangeBanner } from "@/components/auth/pending-email-change-banner";
import { SplitHalfHost } from "@/components/coach/desktop/split-half";

// The coach's own areas (/groups, /clients, /dashboard) share this layout. It stays mounted while the coach moves between their pages, which is what lets the
// workspace (the panel and floating cards, with the pages loaded in them) survive navigating the main page. (The (coach) folder is a route group: it is not in the
// address.) The signed-in person is read here, on the server, so the workspace knows whose it is from the first render and never waits for a page to say so.
// A page shown inside a workspace pane is told so (from the browser's own Sec-Fetch-Dest label) and gets no workspace of its own.
export default async function CoachAreaLayout({ children }: { children: React.ReactNode }) {
  const embedded = await isEmbeddedRequest();
  let userId: string | null = null;
  if (!embedded) {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }
  return (
    <EmbeddedProvider embedded={embedded}>
      {!embedded && <OrgThemeSync />}
      {!embedded && userId && <PendingEmailChangeBanner userId={userId} />}
      {/* SplitHalfHost keeps the left half's pages (the list panel's tiles) alive while the main page changes, the same way the workspace keeps its panes. */}
      <WorkspaceHost userId={userId}>
        <SplitHalfHost>{children}</SplitHalfHost>
      </WorkspaceHost>
    </EmbeddedProvider>
  );
}
