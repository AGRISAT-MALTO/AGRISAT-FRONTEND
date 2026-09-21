import { cn } from "@/lib/utils";

interface ConfirmPanelProps {
  lat: number;
  lng: number;
  polygon: Array<{ lat: number; lng: number }>;
  candidateCulture: string;
  candidateConfidence: number;
  zoom?: number;
  className?: string;
}

/**
 * Panneau de confirmation multi-capteurs.
 * La confirmation est déjà calculée côté backend lors de l'analyse
 * (votes affichés dans la fiche) : ce panneau rappelle le verdict candidat
 * sans refaire d'appel réseau.
 */
export default function ConfirmPanel({
  lat,
  lng,
  candidateCulture,
  candidateConfidence,
  className,
}: ConfirmPanelProps) {
  return (
    <div className={cn("rounded-md border border-border/70 bg-muted/40 px-2.5 py-2 text-[11px]", className)}>
      <p className="font-medium text-foreground">Confirmation multi-capteurs</p>
      <p className="text-muted-foreground mt-0.5">
        {candidateCulture} · {Math.round(candidateConfidence * 100)}% · {lat.toFixed(5)},{" "}
        {lng.toFixed(5)}
      </p>
      <p className="text-muted-foreground mt-0.5">
        Verdict confirmé appliqué lors de l'analyse (Sentinel-2 + Landsat + S1 + HR + météo).
      </p>
    </div>
  );
}
