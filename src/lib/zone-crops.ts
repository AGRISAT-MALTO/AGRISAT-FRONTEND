/**
 * Cultures des parcelles d'une zone d'analyse.
 *
 * Appelle /api/zone-crops, qui restitue les parcelles relevees au sol par le
 * CIRAD (base JECAM, Antsirabe) avec la culture predite par un classifieur
 * temporel entraine sur des series Sentinel-2.
 *
 * Restitution par parcelle : en lui passant les parcelles deja tracees a
 * l'ecran (`parcels`), le service reporte la culture sur CHAQUE parcelle au
 * lieu de colorier les ilots JECAM d'un seul tenant - certains font 30 ha et
 * recouvraient des quartiers entiers. Les ilots qu'aucune parcelle tracee ne
 * couvre reviennent avec `granularity: "bloc"` : a dessiner en contour seul.
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

import type { ZoneParcelFeature, ZoneParcelsResult } from "@/lib/zone-parcels";

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
  /**
   * "parcelle" : contour a la taille d'une parcelle, a remplir.
   * "bloc" : ilot JECAM de plus de 2 ha qu'aucune parcelle tracee ne decoupe —
   * a dessiner en contour seul, sinon il repeint tout un quartier.
   */
  granularity: "parcelle" | "bloc";
  /** D'ou vient le CONTOUR : "JECAM" (releve terrain) ou le modele de tracage. */
  geometry_source: string;
  /** Identifiant de l'ilot JECAM dont vient la CULTURE. */
  jecam_id: string | null;
  /** Part de la parcelle tracee couverte par cet ilot (null si contour JECAM). */
  cover_ratio: number | null;
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
  /** Parcelles dont la culture a ete reportee depuis un ilot JECAM. */
  n_from_traced: number;
  /** Ilots restes non decoupes, dessines en contour seul. */
  n_blocs: number;
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

/** Parcelle tracee envoyee au service : contour et strict necessaire. */
export interface TracedParcelForCrops {
  type: "Feature";
  geometry: ZoneParcelFeature["geometry"];
  properties: {
    parcel_id: string | undefined;
    area_ha: number;
    source: string;
  };
}

export interface ZoneCropsOptions {
  /** Ne garder que les predictions au-dessus de ce seuil (0 a 1). */
  minConfidence?: number;
  /** Restreindre a certaines cultures. */
  crops?: string[];
  /**
   * Parcelles deja tracees a l'ecran : la culture est alors restituee par
   * parcelle plutot que par ilot. Voir `tracedParcelsForCrops`.
   */
  parcels?: TracedParcelForCrops[];
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
 * Nombre maximal de parcelles tracees envoyees au service.
 *
 * Une parcelle pese quelques centaines d'octets en GeoJSON : au-dela, la
 * requete devient plus longue a transmettre que le calcul lui-meme.
 */
const MAX_PARCELS_SENT = 3000;

const M_PER_DEG_LAT = 111_132;
const M_PER_DEG_LNG_EQUATOR = 111_320;

/** Centre approche d'une geometrie, a partir de son enveloppe. */
function featureCenter(feature: ZoneParcelFeature): { lat: number; lng: number } | null {
  const rings: number[][][] =
    feature.geometry.type === "Polygon"
      ? (feature.geometry.coordinates as number[][][])
      : (feature.geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);
  const points = rings.flat();
  if (points.length === 0) return null;
  let north = -Infinity, south = Infinity, east = -Infinity, west = Infinity;
  for (const [lng, lat] of points) {
    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lng < west) west = lng;
  }
  return { lat: (north + south) / 2, lng: (east + west) / 2 };
}

/**
 * Coordonnees arrondies au millionieme de degre (environ 11 cm).
 *
 * La requete est renvoyee a chaque carre tracé : sur quelques milliers de
 * parcelles, garder les 15 decimales des flottants double la taille du corps
 * sans rien apporter — les contours viennent d'une image a 1,2 m.
 */
function roundRing(ring: number[][]): number[][] {
  return ring.map(([lng, lat]) => [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]);
}

function compactGeometry(geometry: ZoneParcelFeature["geometry"]): ZoneParcelFeature["geometry"] {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: (geometry.coordinates as number[][][]).map(roundRing) };
  }
  return {
    type: "MultiPolygon",
    coordinates: (geometry.coordinates as number[][][][]).map((polygon) => polygon.map(roundRing)),
  };
}

/**
 * Parcelles tracees du cercle d'analyse, a passer a `fetchZoneCrops`.
 *
 * Les plus proches d'abord : si la zone est tres peuplee, ce sont celles-la que
 * l'utilisateur regarde. Une marge est laissee autour du cercle pour qu'un ilot
 * a cheval sur le bord soit quand meme decoupe. Seules les proprietes utiles au
 * report de culture sont envoyees.
 */
export function tracedParcelsForCrops(
  traced: ZoneParcelsResult | null,
  lat: number,
  lng: number,
  radiusM: number,
): TracedParcelForCrops[] {
  if (!traced) return [];
  const longitudeScale = Math.max(Math.abs(Math.cos((lat * Math.PI) / 180)), 0.1);
  const maxDistanceM = radiusM + 300;

  return traced.geojson.features
    .flatMap((feature) => {
      const center = featureCenter(feature);
      if (!center) return [];
      const eastM = (center.lng - lng) * M_PER_DEG_LNG_EQUATOR * longitudeScale;
      const northM = (center.lat - lat) * M_PER_DEG_LAT;
      const distanceM = Math.hypot(eastM, northM);
      if (distanceM > maxDistanceM) return [];
      return [{ distanceM, feature }];
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, MAX_PARCELS_SENT)
    .map(({ feature }) => ({
      type: "Feature" as const,
      geometry: compactGeometry(feature.geometry),
      properties: {
        parcel_id: feature.properties.parcel_id ?? feature.properties.ftw_id,
        area_ha: feature.properties.area_ha,
        source: feature.properties.source,
      },
    }));
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
      parcels: options.parcels ?? null,
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
