import { isEmbeddedRequest } from "@/lib/embedded-request";
import { EmbeddedProvider } from "@/components/shared/embedded-context";

// Wrapped around the coach's own areas (/groups, /clients, /dashboard) by their layouts: tells every page below whether it is being shown inside a workspace pane.
export async function EmbeddedGate({ children }: { children: React.ReactNode }) {
  return <EmbeddedProvider embedded={await isEmbeddedRequest()}>{children}</EmbeddedProvider>;
}
