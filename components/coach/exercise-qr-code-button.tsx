"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";

// equipment_qr_decal_scoping_sept19.md — generates a QR sticker a coach
// can print and stick on the actual piece of gym equipment. Encodes a
// stable URL (/scan/[exerciseId]) — no per-org/per-print state to track,
// so client-side generation on open is all this needs, no new API route.
export function ExerciseQrCodeButton({ exerciseId, exerciseName }: { exerciseId: string; exerciseName: string }) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [scanUrl, setScanUrl] = useState("");

  async function handleOpen() {
    const url = `${window.location.origin}/scan/${exerciseId}`;
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
        aria-label={`Get QR code for ${exerciseName}`}
        className="w-8 h-8 flex items-center justify-center text-steel active:text-rust transition-colors"
      >
        <QrCode className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-graphite/80 flex items-center justify-center px-6"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-surface border border-steel/20 p-6 max-w-xs w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-display uppercase text-sm tracking-wide mb-3">{exerciseName}</p>
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- locally generated data URL, not an external image
              <img src={dataUrl} alt={`QR code linking to ${scanUrl}`} className="w-full aspect-square" />
            ) : (
              <div className="w-full aspect-square flex items-center justify-center">
                <p className="font-body text-xs text-steel">Generating…</p>
              </div>
            )}
            <p className="font-body text-[11px] text-steel mt-3 break-all">{scanUrl}</p>
            <div className="flex items-center gap-2 mt-4">
              {dataUrl && (
                <a
                  href={dataUrl}
                  download={`${exerciseName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-qr.png`}
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
