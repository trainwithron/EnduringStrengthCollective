import { isEmbeddedRequest } from "@/lib/embedded-request";
import { EmbeddedProvider } from "@/components/shared/embedded-context";
import { WorkspaceHost } from "@/components/coach/workspace/workspace-host";

// The coach's own areas (/groups, /clients, /dashboard) share this layout. It stays mounted while the coach moves between their pages, which is what lets the
// workspace (the panel and floating cards, with the pages loaded in them) survive navigating the main page. (The (coach) folder is a route group: it is not in the address.)
// A page shown inside a workspace pane is told so (from the browser's own Sec-Fetch-Dest label) and gets no workspace of its own.
export default async function CoachAreaLayout({ children }: { children: React.ReactNode }) {
  const embedded = await isEmbeddedRequest();
  return (
    <EmbeddedProvider embedded={embedded}>
      <WorkspaceHost>{children}</WorkspaceHost>
    </EmbeddedProvider>
  );
}
