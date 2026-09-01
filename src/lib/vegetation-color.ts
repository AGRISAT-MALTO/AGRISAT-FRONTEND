// Mêmes seuils et teintes que les tokens CSS --vegetation-high/medium/low/none (src/index.css).
// Dupliqué ici en littéral hsl() car les Polygon options de Google Maps ne peuvent pas
// résoudre les variables CSS (var(--vegetation-high)) — seule une chaîne de couleur littérale
// est acceptée par l'API JS.
export const VEGETATION_HEX = {
  high: "hsl(142, 60%, 45%)",
  medium: "hsl(80, 50%, 45%)",
  low: "hsl(35, 60%, 50%)",
  none: "hsl(0, 50%, 50%)",
} as const;

export type VegetationTier = keyof typeof VEGETATION_HEX;

export function vegetationTier(percentage: number | null | undefined): VegetationTier {
  if (percentage == null) return "none";
  if (percentage >= 70) return "high";
  if (percentage >= 40) return "medium";
  if (percentage >= 20) return "low";
  return "none";
}

export function vegetationColor(percentage: number | null | undefined): string {
  return VEGETATION_HEX[vegetationTier(percentage)];
}
