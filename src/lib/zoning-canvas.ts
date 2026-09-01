import type { ZoningResult } from "@/lib/zoning";

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Construit le raster de zones VRA (une couleur par classe NDVI, pixels hors parcelle
 * transparents) en canvas hors-écran, à sa résolution native (~10 m/pixel) — partagé entre
 * ZoningOverlay (superposition carte) et l'export PDF (aperçu des zones).
 */
export function buildZoningCanvas(result: ZoningResult): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = result.widthPx;
  canvas.height = result.heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const binary = atob(result.classes);
  const classes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) classes[i] = binary.charCodeAt(i);

  const palette = result.zones.map((zone) => hexToRgb(zone.color));
  const imageData = ctx.createImageData(result.widthPx, result.heightPx);
  for (let i = 0; i < classes.length; i++) {
    const rgb = palette[classes[i]];
    const offset = i * 4;
    if (!rgb) {
      imageData.data[offset + 3] = 0;
      continue;
    }
    imageData.data[offset] = rgb[0];
    imageData.data[offset + 1] = rgb[1];
    imageData.data[offset + 2] = rgb[2];
    imageData.data[offset + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Même raster, mis à l'échelle avec un rendu "en blocs" (nearest-neighbor) pour un affichage net. */
export function buildUpscaledZoningCanvas(result: ZoningResult, factor: number): HTMLCanvasElement | null {
  const base = buildZoningCanvas(result);
  if (!base) return null;
  const upscaled = document.createElement("canvas");
  upscaled.width = base.width * factor;
  upscaled.height = base.height * factor;
  const ctx = upscaled.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, upscaled.width, upscaled.height);
  return upscaled;
}
