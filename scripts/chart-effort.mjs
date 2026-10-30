// Draws the reasoning-effort sweep (evals/results/*-effort.json) as one PNG for the deck:
// rows are the two tasks, columns are how often it was right and how long it took.
// Usage: node scripts/chart-effort.mjs [evals/results/effort.png]
import { readFile } from "node:fs/promises";

import sharp from "sharp";

const out = process.argv[2] ?? "evals/results/effort.png";
const verifierRun = JSON.parse(await readFile("evals/results/verifier-effort.json", "utf8"));
const platesRun = JSON.parse(await readFile("evals/results/nameplates-effort.json", "utf8"));
const verifier = verifierRun.summary;
const plates = platesRun.summary;
// Suite sizes, from one run of each.
const lines = verifierRun.results[0].lines;
const reads = platesRun.results.filter((r) => r.effort === platesRun.results[0].effort && r.trial === 0 && r.fields);

const C = { surface: "#fcfcfb", text: "#0b0b0b", muted: "#52514e", faint: "#8a8984", grid: "#e4e3df", bar: "#2a78d6", other: "#a9c6ec" };
const W = 1600;
const H = 940;
const rows = [
  {
    title: "Checking each note line against its sources",
    model: `Muse Spark Open on Fireworks · ${lines.length} lines (${lines.filter((l) => l.seeded).length} seeded mistakes) × ${verifier[0].trials} runs`,
    app: "low",
    bars: verifier.map((s) => ({ label: s.effort, right: s.exact * 100, secs: s.msPerLine / 1000 })),
    rightLabel: "Lines judged right",
    secsLabel: "Seconds per line",
  },
  {
    title: "Reading equipment rating plates",
    model: `Muse Spark · ${reads.length} plates, ${reads.reduce((n, r) => n + r.fields.length, 0)} fields × ${plates[0].reads / reads.length} runs`,
    // The app read plates at the model default until this sweep; it now uses minimal.
    app: "minimal",
    bars: plates.map((s) => ({ label: s.effort, right: s.right * 100, secs: s.msPerPlate / 1000 })),
    rightLabel: "Fields read right",
    secsLabel: "Seconds per plate",
  },
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const text = (x, y, s, { size = 20, fill = C.text, anchor = "start", weight = 400 } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" font-family="Helvetica, Arial, sans-serif">${esc(s)}</text>`;

// One column chart: bars from a shared baseline, 4px rounded tops, value on each cap.
function panel(x, y, w, h, bars, value, max, fmt, label, app) {
  const parts = [text(x, y - 46, label, { size: 20, fill: C.muted, weight: 600 })];
  const base = y + h;
  for (const t of [0, 0.5, 1]) {
    const gy = base - t * h;
    parts.push(`<line x1="${x}" x2="${x + w}" y1="${gy}" y2="${gy}" stroke="${C.grid}" stroke-width="1"/>`);
    parts.push(text(x - 10, gy + 6, fmt(t * max, true), { size: 16, fill: C.faint, anchor: "end" }));
  }
  const band = w / bars.length;
  const bw = Math.min(24 * 2, band * 0.5);
  bars.forEach((b, i) => {
    const v = value(b);
    const bh = Math.max(2, (v / max) * h);
    const bx = x + i * band + (band - bw) / 2;
    const top = base - bh;
    const r = 4;
    const fill = b.label === app ? C.bar : C.other;
    parts.push(
      `<path d="M${bx},${base} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + bw - r} Q${bx + bw},${top} ${bx + bw},${top + r} V${base} Z" fill="${fill}"/>`,
    );
    parts.push(text(bx + bw / 2, top - 8, fmt(v), { size: 17, anchor: "middle" }));
    parts.push(text(bx + bw / 2, base + 26, b.label, { size: 17, fill: b.label === app ? C.text : C.muted, anchor: "middle", weight: b.label === app ? 700 : 400 }));
    if (b.label === app) parts.push(text(bx + bw / 2, base + 46, "app uses", { size: 14, fill: C.muted, anchor: "middle" }));
  });
  return parts.join("\n");
}

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.surface}"/>`;
svg += text(60, 64, "More reasoning effort didn't make Muse more accurate here, only slower", { size: 32, weight: 700 });
svg += text(60, 98, "Muse Spark reasoning effort, from minimal to max, on two of muse-fieldnotes' real tasks", { size: 20, fill: C.muted });
rows.forEach((row, r) => {
  const y = 170 + r * 370;
  svg += text(60, y, row.title, { size: 24, weight: 700 });
  svg += text(60, y + 28, row.model, { size: 17, fill: C.muted });
  const maxSecs = Math.ceil(Math.max(...row.bars.map((b) => b.secs)) / 10) * 10;
  svg += panel(130, y + 110, 640, 170, row.bars, (b) => b.right, 100, (v, axis) => (axis ? `${v}%` : `${v.toFixed(0)}%`), row.rightLabel, row.app);
  svg += panel(910, y + 110, 640, 170, row.bars, (b) => b.secs, maxSecs, (v, axis) => (axis ? `${v}` : `${v.toFixed(1)} s`), row.secsLabel, row.app);
});
svg += "</svg>";

await sharp(Buffer.from(svg)).png().toFile(out);
console.log(out);
