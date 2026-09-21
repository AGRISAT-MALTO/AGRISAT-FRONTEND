const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface MicroConfirmVote {
  source: string;
  label: string | null;
  confidence: number;
  agreement: "agree" | "partial" | "disagree" | "unknown";
  reason: string;
}

export interface MicroParcelFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: {
    class: string;
    culture: string;
    confidence: number;
    confirmation: "confirmée" | "à vérifier";
    confirmationMethod: string;
    alternatives: string[];
    areaHa: number;
    meanNDVI: number | null;
    meanNDRE: number | null;
    meanNDWI: number | null;
    meanEVI: number | null;
    barleyPresence: "confirmed" | "not_applicable";
    confirmationScore?: number | null;
    confirmationVerdict?: string;
    confirmationTally?: { agree: number; partial: number; disagree: number; expressed: number } | null;
    confirmationVotes?: MicroConfirmVote[];
  };
}

export interface MicroParcelsResult {
  type: "FeatureCollection";
  features: MicroParcelFeature[];
  analysisId?: string | null;
  analysisDate?: string | null;
  center: { lat: number; lng: number };
  radiusM: number;
  imageZoom: number;
  segmentation: { segments: number; groups: number; microParcels: number; metersPerPixel: number };
  gddCumulative: number | null;
  gddThreshold: number;
  confidenceThreshold: number;
  warnings: string[];
}

export async function fetchLatestMicroAnalysis(lat: number, lng: number): Promise<MicroParcelsResult | null> {
  const response = await fetch(`${API_URL}/api/micro-parcels/latest?lat=${lat}&lng=${lng}`);
  if (response.status === 404) return null;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(`Historique micro-parcelles indisponible (${response.status}).`);
  if (!data || typeof data !== "object") throw new Error("Historique micro-parcelles invalide.");
  return data as MicroParcelsResult;
}

export async function runMicroParcelsAnalysis(
  lat: number,
  lng: number,
  radiusM: number,
  options?: {
    confidenceThreshold?: number;
    baseTemperature?: number;
    threshold?: number;
    periodDays?: number;
    sources?: Record<string, boolean>;
  },
): Promise<MicroParcelsResult> {
  const response = await fetch(`${API_URL}/api/micro-parcels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ latitude: lat, longitude: lng, radius: radiusM, ...options }),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
      ? (data as { error: string }).error
      : `L'analyse micro-parcelles est indisponible (${response.status}).`;
    throw new Error(message);
  }
  if (!data || typeof data !== "object") throw new Error("L'analyse micro-parcelles a renvoyé une réponse invalide.");
  return data as MicroParcelsResult;
}
