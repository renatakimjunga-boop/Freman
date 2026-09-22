// One-off generator for production PWA icons.
// Usage: bun scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdir } from "node:fs/promises";

const ANY = "public/icon.svg";
const MASKABLE = "public/icons/maskable.svg";

await mkdir("public/icons", { recursive: true });

const targets = [
  { src: ANY, out: "public/icons/icon-192.png", size: 192 },
  { src: ANY, out: "public/icons/icon-512.png", size: 512 },
  { src: MASKABLE, out: "public/icons/maskable-512.png", size: 512 },
  { src: ANY, out: "public/icons/apple-touch-icon.png", size: 180 },
];

for (const { src, out, size } of targets) {
  await sharp(src, { density: 384 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toFile(out);
  console.log(`wrote ${out} (${size}x${size})`);
}
