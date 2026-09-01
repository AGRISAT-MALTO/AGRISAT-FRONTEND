import { useEffect } from "react";
import type { ZoningResult } from "@/lib/zoning";
import { buildUpscaledZoningCanvas } from "@/lib/zoning-canvas";

interface ZoningOverlayProps {
  map: google.maps.Map | null;
  result: ZoningResult | null;
}

// GroundOverlay renders its image with bilinear smoothing, which would blur the raster's
// crisp pixel edges into a soft gradient. Upscaling with imageSmoothingEnabled=false (in
// buildUpscaledZoningCanvas) bakes hard block edges into the exported PNG itself, so the map
// keeps the "blocky" NDVI-grid look regardless of how Maps scales it further.
const UPSCALE_FACTOR = 6;

/**
 * Superpose le raster de zones VRA directement sur la carte, via un canvas hors-écran converti
 * en GroundOverlay.
 */
export default function ZoningOverlay({ map, result }: ZoningOverlayProps) {
  useEffect(() => {
    if (!map || !result) return;

    const upscaled = buildUpscaledZoningCanvas(result, UPSCALE_FACTOR);
    if (!upscaled) return;

    const bounds = new google.maps.LatLngBounds(
      { lat: result.bounds.south, lng: result.bounds.west },
      { lat: result.bounds.north, lng: result.bounds.east },
    );
    const overlay = new google.maps.GroundOverlay(upscaled.toDataURL("image/png"), bounds, {
      clickable: false,
    });
    overlay.setMap(map);

    return () => {
      overlay.setMap(null);
    };
  }, [map, result]);

  return null;
}
