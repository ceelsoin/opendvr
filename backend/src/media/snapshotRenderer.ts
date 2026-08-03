import sharp from "sharp";
import type { DetectionWithTrack } from "./objectTracker.js";

/**
 * Draws bounding boxes + labels for each detection onto a JPEG, via an SVG
 * overlay composited with sharp - no native canvas/Cairo dependency needed
 * (sharp is already a dependency, see lib/s3Storage.ts). Detections use
 * normalized [x, y, w, h] boxes (0..1, see media/visionWorker.ts); pixel
 * coordinates are derived from the image's own actual dimensions, so this
 * works regardless of the snapshot's resolution. See
 * plans/03-stream-anotada-renderer.md.
 */

const CATEGORY_COLORS: Record<string, string> = {
  person: "#ef4444",
  vehicle: "#3b82f6",
  animal: "#22c55e",
  other: "#eab308",
};

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function drawDetections(jpeg: Buffer, detections: DetectionWithTrack[]): Promise<Buffer> {
  if (detections.length === 0) {
    return jpeg;
  }

  const metadata = await sharp(jpeg).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (width === 0 || height === 0) {
    return jpeg;
  }

  const shapes = detections
    .map((detection) => {
      const [x, y, w, h] = detection.box;
      const boxX = Math.round(x * width);
      const boxY = Math.round(y * height);
      const boxW = Math.round(w * width);
      const boxH = Math.round(h * height);
      const color = CATEGORY_COLORS[detection.category] ?? CATEGORY_COLORS.other;
      const label = escapeXml(`${detection.label} ${Math.round(detection.confidence * 100)}% #${detection.trackId}`);
      // Rough width estimate for a 14px sans-serif label background - doesn't
      // need to be pixel-perfect, just close enough not to clip the text.
      const labelWidth = 8 * label.length + 8;
      const labelY = Math.max(18, boxY);
      return `
        <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" fill="none" stroke="${color}" stroke-width="3" />
        <rect x="${boxX}" y="${labelY - 16}" width="${labelWidth}" height="18" fill="${color}" />
        <text x="${boxX + 4}" y="${labelY - 3}" font-family="sans-serif" font-size="14" fill="#000000">${label}</text>
      `;
    })
    .join("");

  const overlay = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`);

  return sharp(jpeg)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg()
    .toBuffer();
}
