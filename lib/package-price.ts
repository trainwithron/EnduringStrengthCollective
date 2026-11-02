// What a client pays for a package (pure): its own price when the coach set one (the package builder, 0440), otherwise the old rule, the session rate times the sessions it grants.
// Every place that shows or charges a package's price reads it here, so a team, program or coaching package (no sessions) is never shown or charged as $0.
export interface PricedPackage {
  priceCents?: number | null;
  rateCents: number;
  sessionsGranted: number;
}

export function packagePriceCents(p: PricedPackage): number {
  if (typeof p.priceCents === "number" && p.priceCents > 0) return p.priceCents;
  return p.rateCents * p.sessionsGranted;
}

// The same from a database row.
export function rowPriceCents(r: { price_cents?: number | null; rate_cents: number; sessions_granted: number }): number {
  return packagePriceCents({ priceCents: r.price_cents ?? null, rateCents: r.rate_cents, sessionsGranted: r.sessions_granted });
}

export type PackageKind = "team" | "program" | "coaching" | "sessions";

// Ron's names (Nov 2): "training team, program, online coaching, in person coaching".
export const PACKAGE_KIND_LABEL: Record<PackageKind, string> = {
  team: "Training team",
  program: "Program",
  coaching: "Online coaching",
  sessions: "In-person coaching",
};

// A package's kind: the one the coach chose, or (for a package made before kinds existed) read from what it has attached.
export function kindOf(p: { kind?: string | null; defaultProgramId?: string | null; groupAccessGroupId?: string | null }): PackageKind {
  if (p.kind === "team" || p.kind === "program" || p.kind === "coaching" || p.kind === "sessions") return p.kind;
  if (p.groupAccessGroupId) return "team";
  if (p.defaultProgramId) return "program";
  return "sessions";
}

export const CHECKIN_LABEL: Record<number, string> = { 1: "Weekly", 2: "Every 2 weeks", 4: "Monthly" };
