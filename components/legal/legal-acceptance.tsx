"use client";

// The one checkbox asked at signup, claim and join: it shows the short beta notice and links to the terms and privacy
// pages. The caller keeps the checked state and records the acceptance (version and time) when the form is submitted.
export function LegalAcceptance({
  checked,
  onChange,
  id = "legal-accept",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  id?: string;
}) {
  return (
    <div className="border border-steel/25 p-3">
      <p className="font-body text-xs text-steel leading-snug">
        This app is an early version (a beta). It will change, and it is not medical advice. Please keep your own notes
        of anything important.
      </p>
      <label htmlFor={id} className="flex items-start gap-2 mt-3 cursor-pointer">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 w-5 h-5 shrink-0 accent-rust"
        />
        <span className="font-body text-sm text-chalk leading-snug">
          I understand this is a beta and I agree to the{" "}
          <a href="/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Terms
          </a>
          , the{" "}
          <a href="/privacy" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Privacy policy
          </a>{" "}
          and the{" "}
          <a href="/beta" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            Beta notice
          </a>
          .
        </span>
      </label>
    </div>
  );
}
