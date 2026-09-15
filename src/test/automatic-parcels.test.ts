import { describe, expect, it } from "vitest";
import {
  MAX_TRACED_PARCELS_SENT,
  getDetectedBarleySegments,
  isAutomaticBarleyParcel,
  tracedParcelsWithinRadius,
} from "@/lib/automatic-parcels";
import type { ZoneParcelFeature, ZoneParcelsResult } from "@/lib/zone-parcels";

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
