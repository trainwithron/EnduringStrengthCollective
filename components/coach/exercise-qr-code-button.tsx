"use client";

import { useState } from "react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";
import { appOriginBrowser } from "@/lib/app-url";
import { exerciseScanPath } from "@/lib/scan-org";

// equipment_qr_decal_scoping_sept19.md — generates a QR sticker a coach
// can print and stick on the actual piece of gym equipment. Encodes a
// stable URL (/scan/[exerciseId]) — no per-org/per-print state to track,
// so client-side generation on open is all this needs, no new API route.
// The code carries the workspace's organization (?org=), so the page shows the gym it was printed for; a coach can be in several (lib/scan-org.ts).
export function ExerciseQrCodeButton({ exerciseId, exerciseName, orgId = null }: { exerciseId: string; exerciseName: string; orgId?: string | null }) {
  return <ScanQrCodeButton path={exerciseScanPath(exerciseId, orgId)} name={exerciseName} what="exercise" />;
}

// The same QR code, for any scan page: an exercise (/scan/<id>) or a machine (/scan/machine/<id>, every exercise done on it; Ron, Nov 19). With `label`, the button shows its word
// next to the icon and is a full 44px tap target (a machine's own button); without, the small icon of an exercise row.
export function ScanQrCodeButton({ path, name, what, label }: { path: string; name: string; what: "exercise" | "machine"; label?: string }) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [scanUrl, setScanUrl] = useState("");
  const dialogRef = useDialogA11y<HTMLDivElement>(open, () => setOpen(false));

  async function handleOpen() {
    const url = `${appOriginBrowser()}${path}`;
    setScanUrl(url);
    setOpen(true);
    if (!dataUrl) {
      const png = await QRCode.toDataURL(url, { width: 320, margin: 2 });
      setDataUrl(png);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Get QR code for ${name}`}
        className={label ? "min-h-11 px-3 inline-flex items-center gap-2 border border-steel/40 text-chalk font-body text-sm active:border-rust" : "w-8 h-8 flex items-center justify-center text-steel active:text-rust transition-colors"}
      >
        <QrCode className="w-4 h-4" aria-hidden={label ? true : undefined} />
        {label}
      </button>

      {open && (
        <div
          ref={dialogRef} role="dialog" aria-modal="true" aria-label={`QR code for this ${what}`}
          className="fixed inset-0 z-50 bg-graphite/80 flex items-center justify-center px-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface border border-steel/20 p-6 max-w-xs w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display uppercase text-sm tracking-wide mb-3">{name}</p>
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- locally generated data URL, not an external image
              <img src={dataUrl} alt={`QR code linking to ${scanUrl}`} className="w-full aspect-square" />
            ) : (
              <div className="w-full aspect-square flex items-center justify-center">
                <p className="font-body text-xs text-steel">Generating…</p>
              </div>
            )}
            <p className="font-body text-xs text-steel mt-3 break-all">{scanUrl}</p>
            <div className="flex items-center gap-2 mt-4">
              {dataUrl && (
                <a
                  href={dataUrl}
                  download={`${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`}
                  className="flex-1 h-9 flex items-center justify-center bg-rust text-graphite font-body text-xs font-medium"
                >
                  Download
                </a>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 h-9 border border-steel/30 text-steel font-body text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
