import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LABEL_CALL, LABEL_FOOTER, LABEL_LINE, machineLabelsPath, orgInitials, parseLabelIds } from "@/lib/machine-labels";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("print-ready machine labels (Ron, Nov 20: M3)", () => {
  it("one address for every machine, or the ones named", () => {
    expect(machineLabelsPath()).toBe("/print/machine-labels");
    expect(machineLabelsPath([A, B])).toBe(`/print/machine-labels?ids=${A},${B}`);
    expect(parseLabelIds(`${A},nope,${B.toUpperCase()},${A}`)).toEqual([A, B]);
    expect(parseLabelIds(undefined)).toBeNull();
    expect(parseLabelIds("junk")).toBeNull();
  });
  it("the gym's initials stand in for a missing logo", () => {
    expect(orgInitials("Enduring Strength Co.")).toBe("ES");
    expect(orgInitials("The Iron Room")).toBe("IR");
    expect(orgInitials("Forge")).toBe("F");
    expect(orgInitials("")).toBe("G");
  });
  it("the words are the approved design's", () => {
    expect(LABEL_CALL).toBe("Scan for how-to");
    expect(LABEL_LINE).toBe("Setup, form tips and a demo video. No app needed.");
    expect(LABEL_FOOTER).toBe("spotlightcoaching.app");
  });
  it("is a 4 by 6 inch white page per label, Oswald type, the same QR code and address as the machine's QR button", () => {
    const page = read("app/print/machine-labels/page.tsx");
    expect(page).toContain("@page { size: 4in 6in; margin: 0; }");
    expect(page).toContain("width: 4in; height: 6in;");
    expect(page).toContain("break-after: page; page-break-after: always;");
    expect(page).toContain("font-weight: 700; font-size: 30px;");
    expect(page).toContain("border: 3px solid #111111; border-radius: 14px;");
    expect(page).toContain(".label-call { font-weight: 600; font-size: 24px;");
    expect(page).toContain('googleFontsHref(["Oswald"])');
    expect(page).toContain('import QRCode from "qrcode";');
    expect(page).toContain("`${origin}${machineScanPath(m.id)}`");
    expect(read("components/coach/exercise-qr-code-button.tsx")).toContain("QRCode.toDataURL(url");
    // only the coach's own machines
    expect(page).toContain('.eq("created_by", user.id)');
    // the logo, or the initials circle, and the gym's name
    expect(page).toContain("l.org?.logoUrl ?");
    expect(page).toContain('className="label-initials"');
    // never the plain accent: this page is black on white
    expect(page).not.toMatch(/text-rust(?![-\w])/);
  });
  it("Print labels sits where machines are managed: every machine, and each machine's own", () => {
    const panel = read("components/coach/gym-machines-panel.tsx");
    expect(panel).toContain("href={machineLabelsPath()}");
    expect(panel).toContain("Print labels");
    expect(panel).toContain("href={machineLabelsPath([machine.id])}");
  });
});
