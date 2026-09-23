/**
 * Freman Browser — brand asset generator.
 *
 * Recreates the Freman logo (bold geometric wordmark with a red → salmon →
 * white sweep on pure black, letter-spaced BROWSER subtitle right-aligned
 * underneath) as real vector paths using the Poppins typeface, then renders
 * every icon and splash image the PWA needs.
 *
 * Outputs:
 *   public/icon.svg                     favicon + manifest "any" icon
 *   public/icons/maskable.svg           maskable source
 *   public/splash-wordmark.svg          transparent wordmark for the flash page
 *   public/icons/icon-192.png
 *   public/icons/icon-512.png
 *   public/icons/maskable-512.png
 *   public/icons/apple-touch-icon.png
 *   public/splash/ios-*.png             apple-touch-startup-image set
 *
 * Run: bun scripts/generate-brand-assets.mjs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as opentypeNs from "opentype.js";

const opentype = opentypeNs.default ?? opentypeNs;

const ROOT = process.cwd();
const PUB = path.join(ROOT, "public");
const ICONS = path.join(PUB, "icons");
const SPLASH = path.join(PUB, "splash");
const CACHE = path.join(ROOT, "scripts", ".fontcache");

for (const dir of [PUB, ICONS, SPLASH, CACHE]) mkdirSync(dir, { recursive: true });

const FONT_BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl/poppins";

async function ensureFont(name) {
  const dest = path.join(CACHE, name);
  if (!existsSync(dest)) {
    const res = await fetch(`${FONT_BASE}/${name}`);
    if (!res.ok) throw new Error(`Failed to download ${name}: HTTP ${res.status}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`downloaded ${name}`);
  }
  return dest;
}

function loadFont(file) {
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return opentype.parse(ab);
}

const bold = loadFont(await ensureFont("Poppins-Bold.ttf"));
const semi = loadFont(await ensureFont("Poppins-SemiBold.ttf"));

/** Brand palette sampled from the logo artwork. */
const GRADIENT_STOPS = [
  ["0", "#f42a17"],
  ["0.3", "#f55f4e"],
  ["0.55", "#f8a294"],
  ["0.8", "#ffffff"],
  ["1", "#ffffff"],
];

/**
 * Wordmark + subtitle geometry.
 * Sizes are specified at the 512 reference tile and scale linearly:
 *   wordSize 75 → cap height ≈ 52.5/512, matching the source artwork.
 */
const REF = {
  wordSize: 75,
  subSize: 19,
  gap: 10, // baseline of subtitle below wordmark baseline
  trackEm: 0.18, // BROWSER letter-spacing
  centerYOffset: 0.0278, // block sits slightly below center, like the artwork
};

/**
 * Builds the logo paths at a given position. Coordinates are in the same
 * space as the returned bounding box.
 */
function logoElements({ wordSize, subSize, gap, trackEm, x, baselineY }) {
  const wm = bold.getPath("Freman", x, baselineY, wordSize);
  const bb = wm.getBoundingBox();
  const right = bb.x2;

  const track = trackEm * subSize;
  const chars = [..."BROWSER"];
  const widths = chars.map((ch) => semi.getAdvanceWidth(ch, subSize));
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);

  let cx = right - total; // right-aligned to the wordmark, like the artwork
  const subBase = baselineY + gap + subSize * 0.7;
  let sub = "";
  chars.forEach((ch, i) => {
    sub += `<path d="${semi.getPath(ch, cx, subBase, subSize).toPathData(2)}"/>`;
    cx += widths[i] + track;
  });

  const grad = `<linearGradient id="freman-word" gradientUnits="userSpaceOnUse" x1="${bb.x1.toFixed(1)}" y1="${baselineY.toFixed(1)}" x2="${right.toFixed(1)}" y2="${baselineY.toFixed(1)}">
${GRADIENT_STOPS.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("\n")}
</linearGradient>`;

  return {
    grad,
    wmEl: `<path d="${wm.toPathData(2)}" fill="url(#freman-word)"/>`,
    subEl: `<g fill="#ffffff">${sub}</g>`,
    left: bb.x1,
    right,
    top: bb.y1,
    bottom: subBase,
  };
}

/** Full square icon SVG (black tile + centered logo). */
function iconSvg(size, { bg = "#000000", contentScale = 1, centerYOffset = REF.centerYOffset } = {}) {
  const k = (size / 512) * contentScale;
  const base = logoElements({ wordSize: REF.wordSize * k, subSize: REF.subSize * k, gap: REF.gap * k, trackEm: REF.trackEm, x: 0, baselineY: 0 });
  const width = base.right - base.left;
  const x = (size - width) / 2 - base.left;
  const baselineY = size * (0.5 + centerYOffset) - (base.top + base.bottom) / 2;
  const l = logoElements({ wordSize: REF.wordSize * k, subSize: REF.subSize * k, gap: REF.gap * k, trackEm: REF.trackEm, x, baselineY });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ""}<defs>${l.grad}</defs>${l.wmEl}${l.subEl}</svg>`;
}

/** Tight transparent wordmark SVG (for the flash/splash page). */
function wordmarkSvg() {
  const opts = { wordSize: REF.wordSize, subSize: REF.subSize, gap: REF.gap, trackEm: REF.trackEm };
  const base = logoElements({ ...opts, x: 0, baselineY: 0 });
  const pad = 3;
  const vx = base.left - pad;
  const vy = base.top - pad;
  const vw = base.right - base.left + pad * 2;
  const vh = base.bottom - base.top + pad * 2;
  const l = logoElements({ ...opts, x: -vx, baselineY: -vy });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw.toFixed(1)} ${vh.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}"><defs>${l.grad}</defs>${l.wmEl}${l.subEl}</svg>`;
}

async function renderPng(svg, file, resizeTo) {
  let img = sharp(Buffer.from(svg));
  if (resizeTo) img = img.resize(resizeTo, resizeTo);
  await img.png({ compressionLevel: 9 }).toFile(file);
  const meta = await sharp(file).metadata();
  console.log(`${path.relative(ROOT, file)}  ${meta.width}x${meta.height}  ${(meta.size / 1024).toFixed(1)} kB`);
}

// --- Core icon set -----------------------------------------------------------
const icon512 = iconSvg(512);
writeFileSync(path.join(PUB, "icon.svg"), iconSvg(512).replace(/ width="512" height="512"/, "") + "\n");
writeFileSync(path.join(ICONS, "maskable.svg"), iconSvg(512, { contentScale: 0.78, centerYOffset: 0 }).replace(/ width="512" height="512"/, "") + "\n");
writeFileSync(path.join(PUB, "splash-wordmark.svg"), wordmarkSvg() + "\n");

await renderPng(icon512, path.join(ICONS, "icon-512.png"));
await renderPng(icon512, path.join(ICONS, "icon-192.png"), 192);
await renderPng(iconSvg(512, { contentScale: 0.78, centerYOffset: 0 }), path.join(ICONS, "maskable-512.png"));
await renderPng(icon512, path.join(ICONS, "apple-touch-icon.png"), 180);

// --- iOS startup images (apple-touch-startup-image) --------------------------
// [deviceWidth, deviceHeight, devicePixelRatio]
const IOS_DEVICES = [
  [430, 932, 3], // 14/15/16 Pro Max, Plus
  [428, 926, 3], // 12/13 Pro Max
  [414, 896, 3], // XR/XS Max/11
  [414, 896, 2],
  [393, 852, 3], // 14/15/16 Pro
  [390, 844, 3], // 12/13/14
  [375, 812, 3], // X/XS/11 Pro
  [375, 667, 2], // SE/8
  [1024, 1366, 2], // iPad Pro 12.9"
  [834, 1194, 2], // iPad Pro 11"
  [820, 1180, 2], // iPad Air 10.9"
];

function splashSvg(w, h) {
  const logoWidth = Math.round(Math.min(w, h) * 0.52);
  const k = logoWidth / (REF.wordSize * 3.85); // ≈ wordmark width / wordSize at 512 ref
  const base = logoElements({ wordSize: REF.wordSize * k, subSize: REF.subSize * k, gap: REF.gap * k, trackEm: REF.trackEm, x: 0, baselineY: 0 });
  const width = base.right - base.left;
  const x = (w - width) / 2 - base.left;
  const baselineY = h * 0.46 - (base.top + base.bottom) / 2;
  const l = logoElements({ wordSize: REF.wordSize * k, subSize: REF.subSize * k, gap: REF.gap * k, trackEm: REF.trackEm, x, baselineY });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000000"/><defs>${l.grad}</defs>${l.wmEl}${l.subEl}</svg>`;
}

for (const [dw, dh, dpr] of IOS_DEVICES) {
  const w = dw * dpr;
  const h = dh * dpr;
  const file = path.join(SPLASH, `ios-${dw}x${dh}-${dpr}x.png`);
  await sharp(Buffer.from(splashSvg(w, h))).png({ compressionLevel: 9 }).toFile(file);
  const meta = await sharp(file).metadata();
  console.log(`${path.relative(ROOT, file)}  ${meta.width}x${meta.height}  ${(meta.size / 1024).toFixed(1)} kB`);
}

console.log("\nBrand assets generated.");
