/** "2026-03" -> "mars 26" (les points de time_series_s2/time_series_rain sont des libellés mensuels réels). */
export function formatMonthLabel(label: string): string {
  const [y, m] = label.split("-");
  if (!y || !m) return label;
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
}

/** "2026-03" -> "Mars 2026" (variante longue, pour la bande de dates). */
export function formatMonthLabelLong(label: string): string {
  const [y, m] = label.split("-");
  if (!y || !m) return label;
  const date = new Date(Number(y), Number(m) - 1, 1);
  const text = date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
