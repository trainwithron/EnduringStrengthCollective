import { ScreenshotFrame } from "./screenshot-frame";
import { BusinessDashboardPreview, AthleteMobilePreview } from "./previews";

const FEATURES = [
  {
    title: "Program Builder",
    body: "Build full training blocks with real progression models — linear, double progression, or an undulating wave — plus bulk edit, week duplication, and per-client assignment when a program needs to flex for one person.",
  },
  {
    title: "Client Management",
    body: "A real roster with logged workout history, PRs, body-weight trends, coach notes, and a per-client calendar for habits and macro targets — everything you need to know about one client, in one place.",
  },
  {
    title: "Booking & Session Credits",
    body: "Set your recurring availability once; clients book real 1-on-1 slots against it. Sell session-credit packs or recurring memberships and let the credit balance track itself.",
  },
  {
    title: "Nutrition & Macros",
    body: "Set daily macro targets per client, build meal plans from a real recipe hub, and let smart macro fill handle the math from a body-weight entry.",
  },
  {
    title: "Business Dashboard",
    body: "Real income, MRR, and paying-client counts — not an estimate. Configure your own packages and pricing tiers and let checkout, payouts, and the dashboard stay in sync automatically.",
  },
  {
    title: "The Athlete Experience",
    body: "A focused mobile app for logging, a team feed with PR celebrations worth sharing, and wearable sync — so your clients show up because it's built for training, not scrolling.",
  },
];

export function FeatureGrid() {
  return (
    <section className="px-6 py-16 md:py-24 max-w-6xl mx-auto">
      <h2 className="font-display uppercase text-3xl md:text-4xl font-bold text-center max-w-2xl mx-auto">
        Everything a real coaching business runs on
      </h2>
      <p className="font-body text-steel text-center mt-4 max-w-xl mx-auto">
        Not a roadmap — every feature below is live in the app today.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="bg-surface border border-steel/20 p-6"
          >
            <h3 className="font-display uppercase text-xl font-bold text-rust">
              {f.title}
            </h3>
            <p className="font-body text-chalk/80 text-sm mt-2 leading-relaxed">
              {f.body}
            </p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-12">
        <ScreenshotFrame variant="desktop">
          <BusinessDashboardPreview />
        </ScreenshotFrame>
        <div className="flex justify-center">
          <ScreenshotFrame variant="mobile">
            <AthleteMobilePreview />
          </ScreenshotFrame>
        </div>
      </div>
    </section>
  );
}
