import { redirect } from "next/navigation";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { NoAccess } from "@/components/shared/no-access";
import { PrintButton } from "@/components/shared/print-button";
import { configuredAppUrl } from "@/lib/app-url";
import { machineScanPath } from "@/lib/gym-machines";
import { loadScanOrg, type ScanOrg } from "@/lib/scan-org";
import { googleFontsHref } from "@/lib/google-fonts";
import { LABEL_CALL, LABEL_FOOTER, LABEL_LINE, orgInitials, parseLabelIds } from "@/lib/machine-labels";

export const metadata = { title: "Machine labels" };

// Print-ready machine labels (Ron, Nov 20: M3; the approved design): one white 4 by 6 inch label per machine and per page, so a whole gym prints at once (or one machine, ?ids=).
// Top row: the gym's logo (or its initials in a circle) and name; then the machine's name, its QR code (the same code and address as the machine's QR button,
// components/coach/exercise-qr-code-button.tsx, drawn as a sharp vector for print), "Scan for how-to", and the footer. Only the coach's own machines (row security), and the gym
// shown is the one the scan page shows (lib/scan-org.ts). The browser's own print; light on screen too.
export default async function MachineLabelsPage(props: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const { ids: rawIds } = await props.searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ids = parseLabelIds(rawIds);
  let query = supabase.from("gym_machines").select("id, name, organization_id").eq("created_by", user.id).order("created_at");
  if (ids) query = query.in("id", ids);
  const { data: machineRows, error } = await query;
  if (error) return <NoAccess>Your machines couldn&apos;t be loaded right now. Try again in a moment.</NoAccess>;
  const machines = (machineRows ?? []) as { id: string; name: string; organization_id: string | null }[];

  // The address printed in every code: the app's own address when it is set (a label printed from a preview address would be broken for good), else this one.
  const h = await headers();
  const origin = configuredAppUrl() ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost"}`;

  const serviceRole = createServiceRoleClient();
  const orgs = new Map<string, ScanOrg | null>();
  const labels = await Promise.all(
    machines.map(async (m) => {
      const key = m.organization_id ?? "";
      if (!orgs.has(key)) orgs.set(key, await loadScanOrg(serviceRole, user.id, m.organization_id));
      const org = orgs.get(key) ?? null;
      const svg = await QRCode.toString(`${origin}${machineScanPath(m.id)}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } });
      return { id: m.id, name: m.name, org, svg };
    })
  );

  return (
    <div className="labels-sheet min-h-screen" style={{ background: "#ecebe8", color: "#111111" }}>
      {/* The label's own type, Oswald, for this printed page only. */}
      <link rel="stylesheet" href={googleFontsHref(["Oswald"])} precedence="default" />
      <style>{`
        @page { size: 4in 6in; margin: 0; }
        .label { width: 4in; height: 6in; box-sizing: border-box; padding: 0.3in 0.3in 0.22in; background: #ffffff; color: #111111; display: flex; flex-direction: column; align-items: center; text-align: center; font-family: Oswald, "Arial Narrow", Arial, sans-serif; overflow: hidden; }
        .label-org { display: flex; align-items: center; justify-content: center; gap: 0.1in; width: 100%; }
        .label-logo { width: 0.46in; height: 0.46in; object-fit: contain; }
        .label-initials { width: 0.46in; height: 0.46in; border-radius: 9999px; background: #111111; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; }
        .label-org-name { font-weight: 600; font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; line-height: 1.1; max-width: 2.8in; overflow-wrap: anywhere; }
        .label-machine { font-weight: 700; font-size: 30px; line-height: 1.05; text-transform: uppercase; margin-top: 0.2in; max-width: 3.4in; overflow-wrap: anywhere; }
        .label-qr { margin-top: 0.18in; border: 3px solid #111111; border-radius: 14px; padding: 0.12in; width: 2.5in; height: 2.5in; box-sizing: border-box; }
        .label-qr svg { width: 100%; height: 100%; display: block; }
        .label-call { font-weight: 600; font-size: 24px; margin-top: 0.16in; line-height: 1.1; }
        .label-line { font-family: Arial, Helvetica, sans-serif; font-size: 12.5px; margin-top: 0.05in; color: #333333; max-width: 3.2in; }
        .label-footer { margin-top: auto; font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 0.04em; color: #555555; }
        .labels-list { display: flex; flex-direction: column; align-items: center; gap: 0.3in; padding: 0.3in 16px 0.6in; }
        .labels-list .label { box-shadow: 0 1px 3px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.12); }
        @media screen and (max-width: 440px) { .labels-list .label { zoom: 0.86; } }
        @media print {
          html, body { background: #ffffff !important; }
          .labels-sheet { background: #ffffff !important; min-height: 0 !important; }
          .no-print { display: none !important; }
          .labels-list { display: block; padding: 0; }
          .labels-list .label { box-shadow: none; break-after: page; page-break-after: always; }
          .labels-list .label:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ background: "#ffffff", borderBottom: "1px solid #d6d4cf" }}>
        <p className="text-sm" style={{ color: "#444444" }}>
          {labels.length === 1 ? "1 label" : `${labels.length} labels`}, 4 by 6 inches, one per page. In the print settings, pick a 4 x 6 paper size and no scaling.
        </p>
        {labels.length > 0 && <PrintButton />}
      </div>
      {labels.length === 0 ? (
        <p className="no-print text-sm px-4 py-6" style={{ color: "#444444" }}>
          No machines to print yet. Add one in the exercise library&apos;s Machines tab.
        </p>
      ) : (
        <div className="labels-list">
          {labels.map((l) => (
            <section key={l.id} className="label" aria-label={`Label for ${l.name}`} data-machine-label>
              <div className="label-org">
                {l.org?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the gym's own uploaded logo
                  <img src={l.org.logoUrl} alt="" className="label-logo" />
                ) : (
                  <span className="label-initials" aria-hidden="true">
                    {orgInitials(l.org?.name ?? "Gym")}
                  </span>
                )}
                <span className="label-org-name">{l.org?.name ?? "Your gym"}</span>
              </div>
              <h1 className="label-machine">{l.name}</h1>
              <div className="label-qr" role="img" aria-label={`QR code for ${l.name}`} dangerouslySetInnerHTML={{ __html: l.svg }} />
              <p className="label-call">{LABEL_CALL}</p>
              <p className="label-line">{LABEL_LINE}</p>
              <p className="label-footer">{LABEL_FOOTER}</p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
