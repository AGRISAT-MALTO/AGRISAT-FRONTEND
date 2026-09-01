export function computeSurfaceHa(points: Array<{ lat: number; lng: number }>): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const centerLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    const xi = points[i].lng * Math.cos(toRad(centerLat)) * (Math.PI / 180) * R;
    const yi = points[i].lat * (Math.PI / 180) * R;
    const xj = points[j].lng * Math.cos(toRad(centerLat)) * (Math.PI / 180) * R;
    const yj = points[j].lat * (Math.PI / 180) * R;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area / 2) / 10000;
}
