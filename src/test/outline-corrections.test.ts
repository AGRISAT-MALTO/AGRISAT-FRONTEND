import { describe, expect, it } from "vitest";
import { OUTLINE_CORRECTION_SOURCE, applyOutlineCorrections, pointInRing } from "@/lib/outline-corrections";
import type { Parcelle } from "@/hooks/useParcelles";
import type { ZoneParcelFeature, ZoneParcelsResult } from "@/lib/zone-parcels";

function square(lat: number, lng: number, half = 0.0002) {
  return [
    { lat: lat - half, lng: lng - half },
    { lat: lat - half, lng: lng + half },
    { lat: lat + half, lng: lng + half },
    { lat: lat + half, lng: lng - half },
  ];
}

function traced(lat: number, lng: number, areaHa: number): ZoneParcelFeature {
  const ring = square(lat, lng).map((p) => [p.lng, p.lat]);
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
    properties: { parcel_id: `P-${lat}`, confidence: 50, area_ha: areaHa, distance_m: 0, source: "JECAM-VHR" },
  };
}

function result(features: ZoneParcelFeature[]): ZoneParcelsResult {
  return {
    query: { latitude: 0, longitude: 0, radius_m: 1000, min_confidence: 0, min_area_ha: 0 },
    summary: { n_parcels: features.length, area_ha_total: 0, truncated: false, by_size: [], quality: {}, outside_coverage: false },
    attribution: "",
    warnings: [],
    geojson: { type: "FeatureCollection", features },
  };
}

function correction(id: string, coordinates: Array<{ lat: number; lng: number }>): Parcelle {
  return { id, coordinates, surface_ha: 0.3, data_source: OUTLINE_CORRECTION_SOURCE } as Parcelle;
}

describe("applyOutlineCorrections", () => {
  it("remplace la parcelle tracée par sa forme corrigée en gardant ses propriétés", () => {
    const moved = square(-19.8, 47.0001, 0.00025);
    const out = applyOutlineCorrections(result([traced(-19.8, 47.0, 0.8), traced(-19.81, 47.0, 0.05)]), [correction("c1", moved)]);
    const features = out!.geojson.features;
    expect(features).toHaveLength(2);
    const corrected = features.find((f) => f.properties.parcel_id === "P-" + -19.8)!;
    expect(corrected.properties.area_ha).toBe(0.8);
    expect((corrected.geometry.coordinates as number[][][])[0][0]).toEqual([moved[0].lng, moved[0].lat]);
    expect(features.some((f) => f.properties.parcel_id === "P-" + -19.81)).toBe(true);
  });

  it("garde une correction sans parcelle tracée correspondante", () => {
    const out = applyOutlineCorrections(result([traced(-19.8, 47.0, 0.8)]), [correction("c1", square(-19.9, 47.1))]);
    expect(out!.geojson.features).toHaveLength(2);
  });

  it("laisse le résultat intact sans correction", () => {
    const input = result([traced(-19.8, 47.0, 0.8)]);
    expect(applyOutlineCorrections(input, [])).toBe(input);
  });
});

describe("pointInRing", () => {
  it("distingue intérieur et extérieur", () => {
    const ring = square(0, 0, 1);
    expect(pointInRing({ lat: 0.5, lng: 0.5 }, ring)).toBe(true);
    expect(pointInRing({ lat: 2, lng: 0 }, ring)).toBe(false);
  });
});
