"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { posterFileName, type PosterContent } from "@/lib/qr-poster";

// A large QR code of one address, with a plain one-page poster to print and a picture to save (Oct 27: joining a group, a coach's own page). Everything is made in the browser from
// the address alone: no outside service, nothing stored. Print uses the browser's own print (the poster sheet below is the only thing printed while this is open; app/globals.css).
const PNG_W = 1200;
const PNG_H = 1650;
const PNG_QR = 900;

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: string,
  start: number,
  maxWidth: number,
): number {
  let size = start;
  ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
  while (size > 24 && ctx.measureText(text).width > maxWidth) {
    size -= 4;
    ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
  }
  return size;
}

// The saved picture: the same poster as the printed one, black on white.
async function posterPng(url: string, content: PosterContent): Promise<string> {
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, url, {
    width: PNG_QR,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const canvas = document.createElement("canvas");
  canvas.width = PNG_W;
  canvas.height = PNG_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PNG_W, PNG_H);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const maxWidth = PNG_W - 120;
  fitFont(ctx, content.title, "bold", 84, maxWidth);
  ctx.fillText(content.title, PNG_W / 2, 150);
  ctx.drawImage(qr, (PNG_W - PNG_QR) / 2, 200, PNG_QR, PNG_QR);
  let y = 200 + PNG_QR + 90;
  for (const line of content.lines) {
    fitFont(ctx, line, "normal", 56, maxWidth);
    ctx.fillText(line, PNG_W / 2, y);
    y += 80;
  }
  fitFont(ctx, content.callToAction, "bold", 64, maxWidth);
  ctx.fillText(content.callToAction, PNG_W / 2, Math.max(y + 20, PNG_H - 150));
  return canvas.toDataURL("image/png");
}

export function QrPosterButton({
  url,
  content,
  label = "Show QR code",
  className,
}: {
  url: string;
  content: PosterContent;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useDialogA11y<HTMLDivElement>(open, () => setOpen(false));

  async function show() {
    setOpen(true);
    setError(null);
    if (qrFor === url && qrSrc) return;
    try {
      setQrSrc(
        await QRCode.toDataURL(url, {
          width: 720,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        }),
      );
      setQrFor(url);
    } catch {
      setError("Couldn't make the QR code. Try again.");
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const a = document.createElement("a");
      a.href = await posterPng(url, content);
      a.download = posterFileName(content.title);
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setError("Couldn't save the picture. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const ready = qrSrc && qrFor === url;

  return (
    <>
      <button
        type="button"
        onClick={show}
        className={
          className ??
          "min-h-11 px-3 inline-flex items-center gap-2 border border-steel/40 text-chalk font-body text-sm"
        }
      >
        <QrCode className="w-4 h-4" aria-hidden="true" />
        {label}
      </button>

      {/* On the page itself (not inside whatever holds the button), so no parent box can clip it; clicks stay inside it. */}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`QR code: ${content.callToAction}`}
            className="fixed inset-0 z-[60] bg-graphite/80 flex items-center justify-center px-4"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          >
            <div
              className="bg-surface border border-steel/20 p-5 w-full max-w-sm max-h-[92vh] overflow-y-auto text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="font-display font-bold uppercase text-lg leading-tight break-words">
                {content.title}
              </p>
              <div className="mt-3 bg-white p-2">
                {ready ? (
                  // eslint-disable-next-line @next/next/no-img-element -- made here from the address, not an outside image
                  <img
                    src={qrSrc!}
                    alt={`QR code to ${url}`}
                    className="w-full aspect-square"
                  />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center">
                    <p className="font-body text-xs text-black/60">
                      {error ? "" : "Making the code…"}
                    </p>
                  </div>
                )}
              </div>
              {content.lines.map((line) => (
                <p
                  key={line}
                  className="font-body text-sm text-chalk mt-2 break-words"
                >
                  {line}
                </p>
              ))}
              <p className="font-body text-sm font-bold text-chalk mt-2">
                {content.callToAction}
              </p>
              <p className="font-body text-xs text-steel mt-2 break-all">
                {url}
              </p>
              <div className="grid grid-cols-2 gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={!ready}
                  className="min-h-11 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40"
                >
                  Print poster
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!ready || saving}
                  className="min-h-11 border border-rust text-rust font-body text-sm disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save picture"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 w-full mt-2 border border-steel/30 text-steel font-body text-sm"
              >
                Close
              </button>
              {error && (
                <p className="font-body text-xs text-rust mt-2" role="alert">
                  {error}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* The printed poster: hidden on screen; while it exists, printing shows only it (app/globals.css). */}
      {open &&
        ready &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="qr-poster-sheet" aria-hidden="true">
            <p className="qr-poster-title">{content.title}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- made here from the address */}
            <img src={qrSrc!} alt="" className="qr-poster-code" />
            {content.lines.map((line) => (
              <p key={line} className="qr-poster-line">
                {line}
              </p>
            ))}
            <p className="qr-poster-cta">{content.callToAction}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
