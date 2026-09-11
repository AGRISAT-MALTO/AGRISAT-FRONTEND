/**
 * Cultures des parcelles d'une zone d'analyse.
 *
 * Appelle /api/zone-crops, qui restitue les parcelles relevees au sol par le
 * CIRAD (base JECAM, Antsirabe) avec la culture predite par un classifieur
 * temporel entraine sur des series Sentinel-2.
 *
 * A savoir avant d'afficher :
 *  - JECAM est un ECHANTILLONNAGE : environ 2 % des parcelles d'une zone y
 *    figurent. Beaucoup de champs visibles a l'ecran n'auront pas de contour.
 *  - La culture predite est fiable a 60-80 % sur riz, mais, perennes et
 *    maraichage ; nettement moins ailleurs. Filtrer sur `confidence` aide.
 *  - L'orge n'est pas detectable en l'etat (21 parcelles de reference).
 *
 * Le champ `warnings` de la reponse porte ces limites : affichez-le.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ZoneCropProperties {
  parcel_id: string;
  /** Culture relevee au sol par le CIRAD (verite terrain). */
  crop_jecam: string;
  /** Annee du releve terrain. */
  year_jecam: number | null;
  /** Culture predite par le modele. */
  crop_pred: string;
  /** Probabilite de la prediction, 0 a 1. */
  confidence: number;
  area_ha: number | null;
  landcover: string | null;
  irrigated: number | null;
  /** Distance du centroide au point clique, en metres. */
  distance_m: number;
}

export interface ZoneCropFeature {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: ZoneCropProperties;
}

export interface ZoneCropsSummary {
  n_parcels: number;
  area_ha_total: number;
  crops: Array<{ crop: string; n_parcels: number; area_ha: number }>;
  coverage: string;
  outside_coverage: boolean;
}

export interface ZoneCropsResult {
  query: {
    latitude: number;
    longitude: number;
    radius_m: number;
    min_confidence: number;
    crops: string[] | null;
  };
  summary: ZoneCropsSummary;
  warnings: string[];
  geojson: { type: "FeatureCollection"; features: ZoneCropFeature[] };
}

export interface ZoneCropsOptions {
  /** Ne garder que les predictions au-dessus de ce seuil (0 a 1). */
  minConfidence?: number;
  /** Restreindre a certaines cultures. */
  crops?: string[];
  signal?: AbortSignal;
}

/**
 * Palette des cultures, alignee sur les cartes produites par le pipeline
 * agri_field_segmentation pour que l'interface et les rapports concordent.
 */
export const CROP_COLORS: Record<string, string> = {
  Rice: "#2a78d6",
  Maize: "#eb6834",
  Maraichage: "#1baf7a",
  Perennes: "#eda100",
  Soybean: "#e87ba4",
  "Young fallow": "#008300",
  "Sweet potato": "#4a3aa7",
  Carrot: "#1baf7a",
  Potato: "#4a3aa7",
  Pine: "#eda100",
  "Apple tree": "#eda100",
  Cassava: "#e34948",
  Leguminous: "#e87ba4",
};

/**
 * Cereales a paille, mises en evidence separement.
 *
 * Le modele ne SAIT PAS predire l'orge : 21 parcelles de reference seulement,
 * donc elle est versee dans "Autres cultures". En revanche JECAM connait ces
 * parcelles pour les avoir relevees au sol - on les affiche donc a partir de la
 * verite terrain (`crop_jecam`), pas de la prediction.
 *
 * Couleur volontairement vive et distincte du reste de la palette : ce sont des
 * points de reference pour la campagne terrain, ils doivent sauter aux yeux.
 */
export const CEREALES_A_PAILLE = ["Barley", "Oat", "Cereals"] as const;

export const CEREAL_COLORS: Record<string, string> = {
  Barley: "#d62b8a",   // magenta soutenu - l'orge, culture cible de MALTO
  Oat: "#a3499e",      // violet - l'avoine, meme calendrier et meme secteur
  Cereals: "#8e5aa8",
};

/** La parcelle est-elle une cereale a paille d'apres le releve terrain ? */
export function isCereale(cropJecam: string | null | undefined): boolean {
  return !!cropJecam && (CEREALES_A_PAILLE as readonly string[]).includes(cropJecam);
}

const COLOR_FALLBACK = "#9a9890";

export function cropColor(crop: string | null | undefined): string {
  if (!crop) return COLOR_FALLBACK;
  return CROP_COLORS[crop] ?? COLOR_FALLBACK;
}

/** Etiquette lisible pour l'interface. */
export function cropLabel(crop: string | null | undefined): string {
  if (!crop) return "Indetermine";
  const labels: Record<string, string> = {
    Rice: "Riz",
    Maize: "Mais",
    Maraichage: "Maraichage",
    Perennes: "Perennes",
    Soybean: "Soja",
    "Young fallow": "Jachere jeune",
    "Sweet potato": "Patate douce",
    Carrot: "Carotte",
    Potato: "Pomme de terre",
    Pine: "Pin",
    "Apple tree": "Pommier",
    Cassava: "Manioc",
    Leguminous: "Legumineuse",
    Barley: "Orge",
    Oat: "Avoine",
    Cereals: "Cereales",
    "Other (classes rares regroupees)": "Autres cultures",
    "(non predit)": "Non predit",
    "(non renseigne)": "Non renseigne",
  };
  return labels[crop] ?? crop;
}

/**
 * Interroge le backend pour les parcelles d'une zone circulaire.
 *
 * @param lat     latitude du centre
 * @param lng     longitude du centre
 * @param radiusM rayon en metres (50 a 20000)
 */
export async function fetchZoneCrops(
  lat: number,
  lng: number,
  radiusM: number,
  options: ZoneCropsOptions = {},
): Promise<ZoneCropsResult> {
  const response = await fetch(`${API_URL}/api/zone-crops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      latitude: lat,
      longitude: lng,
      radius_m: radiusM,
      min_confidence: options.minConfidence ?? 0,
      crops: options.crops ?? null,
    }),
  });

  if (!response.ok) {
    let detail = `Erreur ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.detail) detail = payload.detail;
    } catch {
      /* corps non JSON : on garde le code HTTP */
    }
    throw new Error(detail);
  }

  return (await response.json()) as ZoneCropsResult;
}
