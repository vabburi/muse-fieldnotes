// Make a real photo safe for the public fixtures: rotate, downscale, black out regions,
// and re-encode without EXIF (sharp drops metadata unless asked to keep it), which
// removes GPS location and camera details.
// Usage: node scripts/prepare-photo.mjs in.jpg out.jpg [--rotate=-90] [--max=2048] [--redact=x,y,w,h ...]
// Redact rectangles are in output pixels (after rotate and resize).
import sharp from "sharp";

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/prepare-photo.mjs in.jpg out.jpg [--rotate=deg] [--max=px] [--redact=x,y,w,h]");
  process.exit(1);
}

const opt = (name) => flags.filter((f) => f.startsWith(`--${name}=`)).map((f) => f.split("=")[1]);
const rotate = Number(opt("rotate")[0] ?? 0);
const max = Number(opt("max")[0] ?? 2048);
const redactions = opt("redact").map((r) => r.split(",").map(Number));

const resized = await sharp(input)
  .autoOrient()
  .rotate(rotate)
  .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
  .toBuffer({ resolveWithObject: true });

const { width, height } = resized.info;
const blackBox = (w, h) => ({
  input: { create: { width: w, height: h, channels: 3, background: "#000" } },
});

await sharp(resized.data)
  .composite(redactions.map(([x, y, w, h]) => ({ ...blackBox(w, h), left: x, top: y })))
  .jpeg({ quality: 85, mozjpeg: true })
  .toFile(output);

const meta = await sharp(output).metadata();
console.log(`${output}: ${width}x${height}, ${redactions.length} redaction(s), exif: ${meta.exif ? "present" : "none"}`);
