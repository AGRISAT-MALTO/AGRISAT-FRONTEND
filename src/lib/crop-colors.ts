/** Couleur par famille de culture — une couleur distincte par produit.
 * Orge en vert (demande explicite), autres teintes proches du produit
 * (jaune maïs, bleu ciel rizière, bleu profond eau libre, marron pomme de terre,
 * rouge tomate/maraîchage...).
 * Chaînes littérales (pas de var CSS) car l'API Google Maps n'accepte que ça. */

export const CROP_COLORS = {
  orge: "#16a34a", // vert — orge confirmée
  ble: "#ca8a04", // ambre blé — céréale à paille
  cereale: "#d4a017", // ambre pâle — céréale indifférenciée (blé/orge)
  mais: "#facc15", // jaune — maïs
  riz: "#0ea5e9", // bleu ciel — rizière inondée (avec végétation)
  eau: "#1e40af", // bleu profond — eau libre (lac / plan d'eau)
  bati: "#57534e", // gris pierre — bâti / urbain
  pommeDeTerre: "#92400e", // marron terre — pomme de terre / manioc
  maraichage: "#ef4444", // rouge tomate — maraîchage (tomate, oignon, chou, carotte)
  legumineuse: "#84cc16", // vert lime — haricot / arachide
  friche: "#78716c", // gris-olive — friche / pâturage
  solNu: "#a8a29e", // beige — sol nu / labour
  inconnu: "#9ca3af", // gris — indéterminé
} as const;

/** Légende affichée sur la carte et le dashboard (ordre = familles principales).
 * L'eau n'y figure plus : une zone en eau est vide (aucun résultat, aucun polygone). */
export const CROP_LEGEND: Array<{ label: string; color: string }> = [
  { label: "Orge", color: CROP_COLORS.orge },
  { label: "Blé", color: CROP_COLORS.ble },
  { label: "Céréale (blé/orge — indifférencié)", color: CROP_COLORS.cereale },
  { label: "Maïs", color: CROP_COLORS.mais },
  { label: "Riz", color: CROP_COLORS.riz },
  { label: "Bâti / urbain", color: CROP_COLORS.bati },
  { label: "Pomme de terre", color: CROP_COLORS.pommeDeTerre },
  { label: "Maraîchage (tomate, oignon, chou, carotte)", color: CROP_COLORS.maraichage },
  { label: "Haricot / Arachide", color: CROP_COLORS.legumineuse },
  { label: "Friche / Pâturage", color: CROP_COLORS.friche },
  { label: "Sol nu / Labour", color: CROP_COLORS.solNu },
];

/** Normalise sans accents/casse pour matcher les libellés (résolus ou bruts, FR/legacy). */
function norm(label: string | null | undefined): string {
  return (label ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Vrai si le libellé/classe désigne de l'eau libre (lac / plan d'eau / zone en eau).
 * Utilisé pour filtrer : l'eau est vide, aucun polygone ni culture ne s'affiche.
 * Gardé pour les anciennes analyses en base qui contiennent encore « EAU ». */
export function isWaterLabel(rawLabel: string | null | undefined): boolean {
  const s = norm(rawLabel);
  if (!s) return false;
  return (
    s === "eau" ||
    s.includes("eau (") ||
    s.includes("plan d'eau") ||
    s.includes("zone en eau") ||
    (s.includes("lac") && !s.includes("laitue"))
  );
}

/** Retourne la couleur associée à un libellé de culture (résolu ou brut).
 * Accepte aussi les codes classe backend (BLE, MAIS, MARAICHAGE, PDT, SOL_NU...).
 * Ordre important : « blé » avant « orge » car le libellé blé mentionne
 * « orge possible » ; « non-orge » exclu avant tout (gris, jamais vert). */
export function cropColor(rawLabel: string | null | undefined): string {
  const s = norm(rawLabel);
  if (!s || s === "culture non identifiee" || s === "culture indeterminee" || s === "inconnu" || s === "autre culture" || s === "autre vegetation" || s === "autre") {
    return CROP_COLORS.inconnu;
  }
  if (s.includes("non-orge") || s.includes("non orge")) return CROP_COLORS.inconnu;
  // Codes classe backend (avec ou sans underscore)
  // « Céréale indifférenciée » avant « blé » : le libellé contient « blé/orge »
  // mais désigne l'ambiguïté, pas un blé avéré.
  if (s === "cereale" || s.includes("indifferencie") || s.includes("ble/orge")) return CROP_COLORS.cereale;
  if (s === "ble" || s.includes("cereale")) return CROP_COLORS.ble;
  if (s === "pdt") return CROP_COLORS.pommeDeTerre;
  if (s === "sol_nu" || s === "sol-nu") return CROP_COLORS.solNu;
  if (s.includes("ble")) return CROP_COLORS.ble;
  if (s.includes("orge")) return CROP_COLORS.orge;
  if (s.includes("mais")) return CROP_COLORS.mais;
  if (s === "eau" || s.includes("eau (") || s.includes("plan d'eau") || s.includes("lac")) return CROP_COLORS.eau;
  if (s === "bati" || s.includes("bati") || s.includes("urbain") || s.includes("batiment")) return CROP_COLORS.bati;
  if (s.includes("riz")) return CROP_COLORS.riz;
  if (s.includes("pomme de terre") || s.includes("manioc") || s === "pdt") return CROP_COLORS.pommeDeTerre;
  if (
    s.includes("maraich") ||
    s.includes("tomate") ||
    s.includes("oignon") ||
    s.includes("chou") ||
    s.includes("carotte") ||
    s.includes("laitue") ||
    s.includes("legume")
  ) {
    return CROP_COLORS.maraichage;
  }
  if (s.includes("haricot") || s.includes("arachide") || s.includes("legumineuse")) return CROP_COLORS.legumineuse;
  if (s.includes("friche") || s.includes("paturage")) return CROP_COLORS.friche;
  if (s.includes("sol nu") || s.includes("labour")) return CROP_COLORS.solNu;
  return CROP_COLORS.inconnu;
}
