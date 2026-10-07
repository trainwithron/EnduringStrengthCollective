import { EmbeddedGate } from "@/components/shared/embedded-gate";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <EmbeddedGate>{children}</EmbeddedGate>;
}
