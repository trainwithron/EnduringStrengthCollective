// Builds every PNG size of the default Spotlight mark from the SVG sources in public/brand/.
//
//   npm run brand:icons        (node scripts/generate-brand-icons.mjs)
//
// To change the default logo: replace public/brand/spotlight-app-icon.svg, spotlight-favicon.svg, spotlight-mark-dark.svg and spotlight-mark-light.svg (keep the file names and
// the 512 / 64 / 200 viewBoxes), run the command above, and commit the result. Nothing else needs to change (see lib/brand.ts). An organisation's own uploaded logo or app
// icon still wins over all of this.
//
// Writes:
//   app/icon.svg, app/favicon.ico            the browser tab icon (SVG, and a 32 x 32 ICO for browsers that want it)
//   app/apple-icon.png                       180 x 180, square corners (iOS rounds it itself)
//   public/icon-192.png, icon-512.png        the home-screen icons the web app manifest lists
//   public/icon-maskable-192.png, -512.png   full-bleed, with the artwork inside the 80 percent safe zone so Android can crop it to any shape
//   public/brand/spotlight-badge-72.png      white on transparent, the small status-bar icon of a push notification
//   public/brand/spotlight-og.png            1200 x 630, the picture a shared link shows
import sharp from "sharp";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const at = (p) => new URL(p, root);
const brand = (name) => readFileSync(at(`public/brand/${name}`), "utf8");

const appIcon = brand("spotlight-app-icon.svg");
const favicon = brand("spotlight-favicon.svg");
const markDark = brand("spotlight-mark-dark.svg");

const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(file);

// ---- the app icon without rounded corners (apple-icon, maskable) ----
const squareIcon = appIcon.replace(/rx="112"/, 'rx="0"');
if (squareIcon === appIcon) throw new Error("spotlight-app-icon.svg no longer has the rounded square this script expects (rx=\"112\")");

// ---- maskable: the same art, smaller, so the whole mark stays inside the safe circle ----
const maskable = squareIcon.replace(/<g transform="[^"]*">/, '<g transform="translate(256 256) scale(1.7) translate(-100 -100)">');
if (maskable === squareIcon) throw new Error("spotlight-app-icon.svg no longer has the <g transform> group this script expects");

await png(appIcon, 192, at("public/icon-192.png").pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await png(appIcon, 512, at("public/icon-512.png").pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await png(maskable, 192, at("public/icon-maskable-192.png").pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await png(maskable, 512, at("public/icon-maskable-512.png").pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await png(squareIcon, 180, at("app/apple-icon.png").pathname.replace(/^\/([A-Za-z]:)/, "$1"));

// ---- the tab icon ----
copyFileSync(at("public/brand/spotlight-favicon.svg"), at("app/icon.svg"));
const ico32 = await sharp(Buffer.from(favicon), { density: 384 }).resize(32, 32).png().toBuffer();
// An ICO file holding one PNG image: a 6-byte header, one 16-byte directory entry, then the PNG.
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt8(0, 8); // palette colours
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(ico32.length, 14); // size of the image
header.writeUInt32LE(22, 18); // where the image starts
writeFileSync(at("app/favicon.ico"), Buffer.concat([header, ico32]));

// ---- the push badge: only the shape counts (Android uses the transparency), so every shape is white ----
const badgeSvg = markDark
  .replace(/stop-color="#[0-9A-Fa-f]{6}"/g, 'stop-color="#FFFFFF"')
  .replace(/fill="#[0-9A-Fa-f]{6}"/g, 'fill="#FFFFFF"')
  .replace(/stroke="#[0-9A-Fa-f]{6}"/g, 'stroke="#FFFFFF"');
await sharp(Buffer.from(badgeSvg), { density: 384 }).resize(72, 72).png().toFile(at("public/brand/spotlight-badge-72.png").pathname.replace(/^\/([A-Za-z]:)/, "$1"));

// ---- the social image: the mark on the dark app background, with the wordmark ----
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0" r="1">
      <stop offset="0" stop-color="#2A2417"/>
      <stop offset="0.7" stop-color="#0D0C0A"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <g transform="translate(90 125) scale(1.8)">${markDark.replace(/^[\s\S]*?<defs>/, "<defs>").replace(/<\/svg>\s*$/, "")}</g>
  <text x="520" y="295" font-family="Barlow Condensed, Arial Narrow, Arial, sans-serif" font-weight="700" font-size="84" letter-spacing="14" fill="#FFF4D6">SPOTLIGHT</text>
  <text x="524" y="352" font-family="Barlow Condensed, Arial Narrow, Arial, sans-serif" font-weight="700" font-size="34" letter-spacing="19" fill="#F4C95D">COACHING</text>
</svg>`;
await sharp(Buffer.from(ogSvg), { density: 72 }).png().toFile(at("public/brand/spotlight-og.png").pathname.replace(/^\/([A-Za-z]:)/, "$1"));

console.log("brand icons written");
