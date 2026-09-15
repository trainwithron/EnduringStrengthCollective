"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  BUTTON_SHAPE_RADIUS,
  BUTTON_SHAPE_LABELS,
  DISPLAY_FONT_OPTIONS,
  BODY_FONT_OPTIONS,
  radiusScaleFor,
  type ButtonShape,
  type DisplayFont,
  type BodyFont,
} from "@/lib/theme";
import { OrgImageUpload } from "./org-image-upload";
import { contrastRatio, passesAA, nearestPassingColor, AA_NORMAL_TEXT_RATIO, AA_LARGE_OR_COMPONENT_RATIO } from "@/lib/color-contrast";

const SHAPES: ButtonShape[] = ["sharp", "rounded", "pill"];

// Live, warn-not-block contrast check for one color pair
// (wcag_contrast_foolproofing_idea.md) — never blocks saving; a coach's
// own brand call still wins, this just makes "these two are basically
// the same color" visible instead of silently shippable.
function ContrastCheckRow({
  label,
  ratio,
  minRatio,
  onUseSuggested,
}: {
  label: string;
  ratio: number | null;
  minRatio: number;
  onUseSuggested?: () => void;
}) {
  const passes = passesAA(ratio, minRatio === AA_NORMAL_TEXT_RATIO ? "normal" : "large");
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="font-body text-xs text-steel">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`font-body text-xs ${passes ? "text-moss" : "text-rust"}`}>
          {ratio === null ? "—" : `${ratio.toFixed(2)}:1`} {passes ? "· Passes AA" : `· Needs ${minRatio}:1`}
        </span>
        {!passes && onUseSuggested && (
          <button
            type="button"
            onClick={onUseSuggested}
            className="font-body text-xs text-rust underline underline-offset-2"
          >
            Use closer color
          </button>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="border border-steel/20" open={defaultOpen}>
      <summary className="font-display uppercase text-sm tracking-wide px-4 py-3 cursor-pointer select-none">
        {title}
      </summary>
      <div className="px-4 pb-4 pt-1 border-t border-steel/20">{children}</div>
    </details>
  );
}

export function BrandingForm({
  organizationId,
  initialButtonShape,
  initialAccentColor,
  initialBackgroundColor,
  initialTextColor,
  initialFontDisplay,
  initialFontBody,
  initialLogoUrl,
  initialAppIconUrl,
}: {
  organizationId: string;
  initialButtonShape: ButtonShape;
  initialAccentColor: string;
  initialBackgroundColor: string;
  initialTextColor: string;
  initialFontDisplay: DisplayFont;
  initialFontBody: BodyFont;
  initialLogoUrl: string | null;
  initialAppIconUrl: string | null;
}) {
  const [buttonShape, setButtonShape] = useState<ButtonShape>(initialButtonShape);
  const [accentColor, setAccentColor] = useState(initialAccentColor);
  const [backgroundColor, setBackgroundColor] = useState(initialBackgroundColor);
  const [textColor, setTextColor] = useState(initialTextColor);
  const [fontDisplay, setFontDisplay] = useState<DisplayFont>(initialFontDisplay);
  const [fontBody, setFontBody] = useState<BodyFont>(initialFontBody);

  // Cheap enough (a handful of float ops) to recompute on every render —
  // no debounce needed, matches the spec's "live as the picker drags"
  // requirement. Text-vs-accent isn't a rendered pair anywhere today, but
  // it's a real check for a coach who uses text color as a label on an
  // accent-filled surface elsewhere in the app.
  const textOnBackgroundRatio = contrastRatio(textColor, backgroundColor);
  const accentOnBackgroundRatio = contrastRatio(accentColor, backgroundColor);
  const textOnAccentRatio = contrastRatio(textColor, accentColor);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function persist(patch: {
    button_shape?: ButtonShape;
    accent_color?: string;
    background_color?: string;
    text_color?: string;
    font_display?: DisplayFont;
    font_body?: BodyFont;
  }) {
    setSaving(true);
    setSaved(false);
    const supabase = createBrowserClient();
    await supabase.from("organizations").update(patch).eq("id", organizationId);
    setSaving(false);
    setSaved(true);
  }

  function handleShapeChange(shape: ButtonShape) {
    setButtonShape(shape);
    persist({ button_shape: shape });
  }

  function handleAccentChange(color: string) {
    setAccentColor(color);
    persist({ accent_color: color });
  }

  function handleBackgroundChange(color: string) {
    setBackgroundColor(color);
    persist({ background_color: color });
  }

  function handleTextColorChange(color: string) {
    setTextColor(color);
    persist({ text_color: color });
  }

  function handleFontDisplayChange(font: DisplayFont) {
    setFontDisplay(font);
    persist({ font_display: font });
  }

  function handleFontBodyChange(font: BodyFont) {
    setFontBody(font);
    persist({ font_body: font });
  }

  function handleApplyNow() {
    // The sidebar/nav colors and fonts are read once when the shell
    // mounts, so a full reload is the simple, reliable way to see the
    // saved theme applied everywhere right away rather than just in the
    // preview below.
    window.location.reload();
  }

  return (
    <div className="max-w-lg space-y-3">
      <Section title="Logo & app icon" defaultOpen>
        <div className="space-y-4">
          <OrgImageUpload
            organizationId={organizationId}
            column="logo_url"
            label="Logo"
            helpText="Shown in in-app headers. Any aspect ratio works."
            initialUrl={initialLogoUrl}
            previewClassName="w-24 h-14"
          />
          <OrgImageUpload
            organizationId={organizationId}
            column="app_icon_url"
            label="App icon"
            helpText="Becomes the home-screen icon when a client adds the app. Use a square image."
            initialUrl={initialAppIconUrl}
            previewClassName="w-14 h-14"
          />
        </div>
      </Section>

      <Section title="Colors">
        <div className="grid grid-cols-3 gap-4">
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              Button / accent color
            </span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accentColor}
                onChange={(e) => handleAccentChange(e.target.value)}
                className="h-10 w-12 bg-surface border border-steel/30 cursor-pointer"
              />
              <input
                type="text"
                value={accentColor}
                onChange={(e) => handleAccentChange(e.target.value)}
                className="h-10 flex-1 min-w-0 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
              />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              Background color
            </span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => handleBackgroundChange(e.target.value)}
                className="h-10 w-12 bg-surface border border-steel/30 cursor-pointer"
              />
              <input
                type="text"
                value={backgroundColor}
                onChange={(e) => handleBackgroundChange(e.target.value)}
                className="h-10 flex-1 min-w-0 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
              />
            </div>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-body text-xs text-steel uppercase tracking-wide">Text color</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={textColor}
                onChange={(e) => handleTextColorChange(e.target.value)}
                className="h-10 w-12 bg-surface border border-steel/30 cursor-pointer"
              />
              <input
                type="text"
                value={textColor}
                onChange={(e) => handleTextColorChange(e.target.value)}
                className="h-10 flex-1 min-w-0 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
              />
            </div>
          </label>
        </div>

        <div className="mt-4 pt-3 border-t border-steel/20 divide-y divide-steel/10">
          <ContrastCheckRow
            label="Text on background"
            ratio={textOnBackgroundRatio}
            minRatio={AA_NORMAL_TEXT_RATIO}
            onUseSuggested={() => {
              const suggestion = nearestPassingColor(textColor, backgroundColor, AA_NORMAL_TEXT_RATIO);
              if (suggestion) handleTextColorChange(suggestion);
            }}
          />
          <ContrastCheckRow
            label="Accent on background"
            ratio={accentOnBackgroundRatio}
            minRatio={AA_LARGE_OR_COMPONENT_RATIO}
            onUseSuggested={() => {
              const suggestion = nearestPassingColor(accentColor, backgroundColor, AA_LARGE_OR_COMPONENT_RATIO);
              if (suggestion) handleAccentChange(suggestion);
            }}
          />
          <ContrastCheckRow
            label="Text on accent"
            ratio={textOnAccentRatio}
            minRatio={AA_LARGE_OR_COMPONENT_RATIO}
            onUseSuggested={() => {
              const suggestion = nearestPassingColor(textColor, accentColor, AA_LARGE_OR_COMPONENT_RATIO);
              if (suggestion) handleTextColorChange(suggestion);
            }}
          />
        </div>
      </Section>

      <Section title="Typography & buttons">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="font-body text-xs text-steel uppercase tracking-wide">
                Heading font
              </span>
              <select
                value={fontDisplay}
                onChange={(e) => handleFontDisplayChange(e.target.value as DisplayFont)}
                className="h-10 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
              >
                {DISPLAY_FONT_OPTIONS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-body text-xs text-steel uppercase tracking-wide">Body font</span>
              <select
                value={fontBody}
                onChange={(e) => handleFontBodyChange(e.target.value as BodyFont)}
                className="h-10 bg-surface border border-steel/30 text-chalk px-2 font-body text-sm"
              >
                {BODY_FONT_OPTIONS.map((font) => (
                  <option key={font} value={font}>
                    {font}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <span className="font-body text-xs text-steel uppercase tracking-wide">Button shape</span>
            <p className="font-body text-xs text-steel mt-1 max-w-[60ch]">
              Also softens cards, badges, inputs, and the logging screen&apos;s set cells app-wide —
              not just buttons.
            </p>
            <div className="flex gap-2 mt-2">
              {SHAPES.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => handleShapeChange(shape)}
                  className={`h-10 px-4 font-body text-sm border flex-1 ${
                    buttonShape === shape
                      ? "border-rust text-chalk bg-surface"
                      : "border-steel/30 text-steel"
                  }`}
                  style={{ borderRadius: BUTTON_SHAPE_RADIUS[shape] }}
                >
                  {BUTTON_SHAPE_LABELS[shape]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="Preview">
        <div
          className="p-6 border border-steel/20 flex flex-col items-center justify-center gap-3"
          style={{ backgroundColor }}
        >
          <p
            className="text-2xl font-bold uppercase leading-none"
            style={{ fontFamily: `"${fontDisplay}", sans-serif`, color: textColor }}
          >
            Sample heading
          </p>
          <p className="text-sm" style={{ fontFamily: `"${fontBody}", sans-serif`, color: textColor }}>
            This is what your body text looks like.
          </p>
          <button
            type="button"
            className="h-10 px-5 text-sm font-medium"
            style={{
              backgroundColor: accentColor,
              color: backgroundColor,
              fontFamily: `"${fontBody}", sans-serif`,
              borderRadius: BUTTON_SHAPE_RADIUS[buttonShape],
            }}
          >
            Save changes
          </button>

          {(() => {
            const scale = radiusScaleFor(buttonShape);
            return (
              <div className="flex items-center gap-3 mt-1">
                <div
                  className="px-3 py-2 text-xs border"
                  style={{ borderColor: `${textColor}33`, borderRadius: scale.lg, color: textColor }}
                >
                  Card
                </div>
                <span
                  className="px-2 py-1 text-[10px] uppercase border"
                  style={{ borderColor: accentColor, color: accentColor, borderRadius: scale.pill }}
                >
                  Badge
                </span>
                <input
                  readOnly
                  value="Input"
                  className="w-20 h-8 text-xs px-2 border bg-transparent"
                  style={{ borderColor: `${textColor}33`, color: textColor, borderRadius: scale.sm }}
                />
              </div>
            );
          })()}
        </div>
      </Section>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleApplyNow}
          className="h-10 px-4 bg-rust text-graphite font-body text-sm font-medium"
        >
          Apply now
        </button>
        <span className="font-body text-xs text-steel">
          {saving ? "Saving…" : saved ? "Saved — applies everywhere in your organization." : ""}
        </span>
      </div>

      <p className="font-body text-xs text-steel max-w-[60ch]">
        This changes the look of the whole app for your organization — the coach desktop dashboard
        and the mobile app your clients use both share this identity.
      </p>
    </div>
  );
}
