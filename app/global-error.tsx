"use client";

import { useEffect } from "react";

// The last-resort boundary — only fires if the ROOT layout itself throws
// (org theming, the PWA prompts, etc.), which app/error.tsx can't catch
// since that boundary lives inside the layout, not around it. Next.js
// requires this file to render its own <html>/<body> because it replaces
// the root layout entirely when it's shown — it deliberately can't use
// the org-theme CSS variables or any other layout-provided context, since
// the layout is exactly what failed.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#1C1B1A",
          color: "#EDE8E0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#908B7E", marginBottom: 24 }}>
            The app hit a problem loading. Try again, or come back in a
            moment.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 40,
              padding: "0 20px",
              background: "#D2703B",
              color: "#1C1B1A",
              border: "none",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
