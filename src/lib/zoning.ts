const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ZoningZone {
  key: "high" | "mid" | "low";
  label: string;
  ndviMin: number;
  ndviMax: number;
  color: string;
  avgNdvi: number | null;
  areaHa: number;
}

export interface ZoningResult {
  /** Vignette satellite (PNG base64, sans préfixe data:) du contour de la parcelle, ou null si Static Maps est indisponible. */
  thumbnail: string | null;
  bounds: { south: number; west: number; north: number; east: number };
  widthPx: number;
  heightPx: number;
  /** Uint8Array encodé en base64 : un octet par pixel (index de zone, ou 255 = hors parcelle). */
  classes: string;
  zones: ZoningZone[];
  totalAreaHa: number;
  imageStartDate: string;
  imageEndDate: string;
}

export async function computeParcelZoning(polygon: Array<{ lat: number; lng: number }>): Promise<ZoningResult> {
  const response = await fetch(`${API_URL}/api/zoning-parcel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ polygon }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Erreur réseau" }));
    throw new Error(err.error || `Erreur ${response.status}`);
  }

  return response.json();
}
