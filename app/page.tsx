import { Hero } from "@/components/marketing/hero";
import { FeatureGrid } from "@/components/marketing/feature-grid";
import { Differentiation } from "@/components/marketing/differentiation";
import { FinalCta } from "@/components/marketing/final-cta";

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <Hero />
      <FeatureGrid />
      <Differentiation />
      <FinalCta />
    </main>
  );
}
