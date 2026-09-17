import { describe, expect, it } from "vitest";
import {
  ANALYSIS_BATCH_SIZE,
  MAX_TRACED_PARCELS_SENT,
  analyzeZoneParcels,
  getDetectedBarleySegments,
  isAutomaticBarleyParcel,
  isNewlyCultivated,
  tracedParcelsWithinRadius,
  type ParcelCultivation,
} from "@/lib/automatic-parcels";
import type { ZoneParcelFeature, ZoneParcelsResult } from "@/lib/zone-parcels";

function parcelWithCultivation(cultivation: ParcelCultivation | undefined) {
  return {
    id: "jecam-vhr-1",
    coordinates: [],
    center: { lat: 0, lng: 0 },
    tags: { source: "jecam-vhr" },
    analysis: { cultivation },
    analysis_error: null,
  };
}

describe("parcelles devenues cultivées", () => {
  const base: ParcelCultivation = {
    status: "cultivee",
    label: "Cultivée",
    ndvi: 0.52,
    image_date: "2026-09-10",
    cloud_percentage: 4,
    previous_bare_month: null,
    previous_bare_ndvi: null,
    newly_cultivated: false,
  };

  it("signale une parcelle nue auparavant et cultivée aujourd'hui", () => {
    expect(isNewlyCultivated(parcelWithCultivation({ ...base, previous_bare_month: "2026-05", previous_bare_ndvi: 0.12, newly_cultivated: true }))).toBe(true);
  });

  it("ne signale ni une parcelle déjà cultivée, ni une parcelle sans état de culture", () => {
    expect(isNewlyCultivated(parcelWithCultivation(base))).toBe(false);
    expect(isNewlyCultivated(parcelWithCultivation(undefined))).toBe(false);
  });
});

function tracedSquare(centerLat: number, centerLng: number, halfDeg = 0.0002): ZoneParcelFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [centerLng - halfDeg, centerLat - halfDeg],
        [centerLng + halfDeg, centerLat - halfDeg],
        [centerLng + halfDeg, centerLat + halfDeg],
        [centerLng - halfDeg, centerLat + halfDeg],
      ]],
    },
    properties: { confidence: 80, area_ha: 0.2, distance_m: 0, source: "JECAM-VHR" },
  };
}

function tracedResult(features: ZoneParcelFeature[]): ZoneParcelsResult {
  return {
    query: { latitude: 0, longitude: 0, radius_m: 1000, min_confidence: 0, min_area_ha: 0 },
    summary: { n_parcels: features.length, area_ha_total: 0, truncated: false, by_size: [], quality: {}, outside_coverage: false },
    attribution: "",
    warnings: [],
    geojson: { type: "FeatureCollection", features },
  };
}

describe("parcelles déjà tracées envoyées à l'analyse", () => {
  it("garde les parcelles proches du point et convertit leur contour en lat/lng", () => {
    const near = tracedSquare(-19.848, 47.012);
    const far = tracedSquare(-19.9, 47.1);
    const parcels = tracedParcelsWithinRadius(tracedResult([near, far]), -19.848, 47.012, 500);

    expect(parcels).toHaveLength(1);
    expect(parcels[0].coordinates).toHaveLength(4);
    expect(parcels[0].coordinates[0]).toEqual({ lat: -19.848 - 0.0002, lng: 47.012 - 0.0002 });
  });

  it("envoie au plus les parcelles les plus proches, dans l'ordre de distance", () => {
    const features = Array.from({ length: MAX_TRACED_PARCELS_SENT + 50 }, (_, index) => tracedSquare(-19.848 + index * 0.00001, 47.012));
    const parcels = tracedParcelsWithinRadius(tracedResult([...features].reverse()), -19.848, 47.012, 5_000);

    expect(parcels).toHaveLength(MAX_TRACED_PARCELS_SENT);
    expect(parcels[0].coordinates[0]).toEqual({ lat: -19.848 - 0.0002, lng: 47.012 - 0.0002 });
  });

  it("ne renvoie rien tant qu'aucune parcelle n'est tracée", () => {
    expect(tracedParcelsWithinRadius(null, -19.848, 47.012, 500)).toEqual([]);
  });

  it("peut renvoyer toutes les parcelles de la zone pour l'analyse complète", () => {
    const features = Array.from({ length: MAX_TRACED_PARCELS_SENT + 50 }, (_, index) => tracedSquare(-19.848 + index * 0.00001, 47.012));
    expect(tracedParcelsWithinRadius(tracedResult(features), -19.848, 47.012, 5_000, Number.POSITIVE_INFINITY)).toHaveLength(MAX_TRACED_PARCELS_SENT + 50);
  });
});

describe("analyse de toutes les parcelles d'une zone", () => {
  const config = { baseTemperature: 0, threshold: 2000, periodDays: 130 };
  const parcelInput = (index: number) => ({ coordinates: [{ lat: index, lng: 0 }, { lat: index, lng: 1 }, { lat: index + 1, lng: 0 }] });

  it("analyse par lots, sans doublon, en mode parcelles tracées seulement", async () => {
    const calls: Array<{ size: number; tracedOnly?: boolean }> = [];
    const search = async (_lat: number, _lng: number, _r: number, _c: typeof config, batch: Array<{ coordinates: Array<{ lat: number; lng: number }> }> = [], options: { tracedOnly?: boolean } = {}) => {
      calls.push({ size: batch.length, tracedOnly: options.tracedOnly });
      return {
        center: { lat: 0, lng: 0 }, radius_km: 1, base_temperature: 0, threshold: 2000, period_days: 130,
        candidates_found: batch.length, analyzed_count: batch.length, notice: null,
        parcels: batch.map((p) => ({ id: `p-${p.coordinates[0].lat}`, coordinates: p.coordinates, center: p.coordinates[0], tags: {}, analysis: { is_barley: false }, analysis_error: null })),
      };
    };
    const progress: string[] = [];
    const parcels = Array.from({ length: ANALYSIS_BATCH_SIZE * 2 + 5 }, (_, i) => parcelInput(i));
    const result = await analyzeZoneParcels(0, 0, 1, config, [...parcels, parcels[0]], (done, total) => progress.push(`${done}/${total}`), search);

    expect(calls.map((c) => c.size)).toEqual([ANALYSIS_BATCH_SIZE, ANALYSIS_BATCH_SIZE, 6]);
    expect(calls.every((c) => c.tracedOnly)).toBe(true);
    expect(result.candidates_found).toBe(parcels.length);
    expect(result.analyzed_count).toBe(parcels.length);
    expect(progress.at(-1)).toBe(`${parcels.length + 1}/${parcels.length + 1}`);
  });

  it("renvoie une seconde fois les parcelles restées sans analyse", async () => {
    let attempt = 0;
    const search = async (_lat: number, _lng: number, _r: number, _c: typeof config, batch: Array<{ coordinates: Array<{ lat: number; lng: number }> }> = []) => {
      attempt += 1;
      return {
        center: { lat: 0, lng: 0 }, radius_km: 1, base_temperature: 0, threshold: 2000, period_days: 130,
        candidates_found: batch.length, analyzed_count: 0, notice: null,
        parcels: batch.map((p) => ({
          id: `p-${p.coordinates[0].lat}`, coordinates: p.coordinates, center: p.coordinates[0], tags: {},
          analysis: attempt === 1 ? null : { is_barley: true }, analysis_error: attempt === 1 ? "délai dépassé" : null,
        })),
      };
    };
    const result = await analyzeZoneParcels(0, 0, 1, config, [parcelInput(1), parcelInput(2)], undefined, search);

    expect(attempt).toBe(2);
    expect(result.analyzed_count).toBe(2);
  });
});

describe("automatic parcel classification", () => {
  it("identifie une analyse déclarée comme orge", () => {
    expect(isAutomaticBarleyParcel({
      id: "osm-way-1",
      coordinates: [],
      center: { lat: 0, lng: 0 },
      tags: {},
      analysis: { is_barley: true },
      analysis_error: null,
    })).toBe(true);
  });

  it("exclut explicitement les parcelles non-orge", () => {
    expect(isAutomaticBarleyParcel({
      id: "osm-way-2",
      coordinates: [],
      center: { lat: 0, lng: 0 },
      tags: {},
      analysis: { culture_detected: "Non-orge" },
      analysis_error: null,
    })).toBe(false);
  });

  it("retient uniquement les contours d'orge avec une géométrie exploitable", () => {
    const segments = getDetectedBarleySegments({
      id: "osm-way-3",
      coordinates: [],
      center: { lat: 0, lng: 0 },
      tags: {},
      analysis: {
        detected_segments: [
          {
            coordinates: [{ lat: 1, lng: 1 }, { lat: 1, lng: 2 }, { lat: 2, lng: 1 }],
            confidence: 92,
            ndvi: 0.63,
            area_ha: 4.5,
          },
          {
            coordinates: [{ lat: 1, lng: 1 }],
            confidence: 80,
            ndvi: 0.5,
            area_ha: 1,
          },
        ],
      },
      analysis_error: null,
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].confidence).toBe(92);
  });
});
