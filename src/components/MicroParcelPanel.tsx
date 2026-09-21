import { Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MicroParcelFeature } from "@/lib/micro-parcels";
import { resolveCropName } from "@/lib/map-tooltip";
import { cropColor } from "@/lib/crop-colors";
import ConfirmPanel from "./ConfirmPanel";

interface MicroParcelPanelProps {
  feature: MicroParcelFeature;
  onClose: () => void;
  onDelete?: (feature: MicroParcelFeature) => void;
  className?: string;
}

/** Fiche d'une micro-parcelle : culture, confiance, surface, indices, alternatives. */
export default function MicroParcelPanel({ feature, onClose, onDelete, className }: MicroParcelPanelProps) {
  const p = feature.properties;
  const cropName = resolveCropName(p.culture, p.meanNDVI);
  const color = cropColor(p.class ?? cropName);
  const ring = feature.geometry.coordinates[0] ?? [];
  const center = ring.length > 0
    ? {
        lat: ring.reduce((s, c) => s + c[1], 0) / ring.length,
        lng: ring.reduce((s, c) => s + c[0], 0) / ring.length,
      }
    : null;

  return (
    <div className={cn("analysis-popup p-4 space-y-3 overflow-y-auto", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-sm border border-black/20" style={{ backgroundColor: color }} />
          <span className="text-sm font-semibold text-foreground">Micro-parcelle</span>
        </div>
        <div className="flex items-center gap-1">
          {onDelete && (
            <button
              onClick={() => onDelete(feature)}
              className="w-6 h-6 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-xs"
              title="Supprimer ce polygone"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground text-xs"
            title="Fermer la fiche"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-muted/40 p-3">
        <p className="text-[11px] text-muted-foreground">Culture détectée</p>
        <p className="text-base font-semibold text-foreground">{cropName}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {Math.round(p.confidence * 100)}% · {p.confirmation} ({p.confirmationMethod})
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-md bg-muted/40 p-2">
          <p className="text-lg font-semibold text-foreground">{p.areaHa}</p>
          <p className="text-[10px] text-muted-foreground">hectares</p>
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <p className="text-lg font-semibold text-foreground">
            {p.meanNDVI != null ? `${Math.round(p.meanNDVI * 100)}%` : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground">NDVI moyen</p>
        </div>
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">NDRE</span>
          <span className="font-medium text-foreground">{p.meanNDRE != null ? p.meanNDRE.toFixed(3) : "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">NDWI</span>
          <span className="font-medium text-foreground">{p.meanNDWI != null ? p.meanNDWI.toFixed(3) : "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">EVI</span>
          <span className="font-medium text-foreground">{p.meanEVI != null ? p.meanEVI.toFixed(3) : "—"}</span>
        </div>
        {center && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Centre</span>
            <span className="font-mono text-foreground">{center.lat.toFixed(5)}, {center.lng.toFixed(5)}</span>
          </div>
        )}
      </div>

      {Array.isArray(p.alternatives) && p.alternatives.length > 0 && (
        <div className="rounded-md bg-amber-100/80 dark:bg-amber-500/15 px-2.5 py-2">
          <p className="text-[11px] text-amber-900 dark:text-amber-300">
            Autres cultures possibles : {p.alternatives.join(", ")}
          </p>
        </div>
      )}

      {center && (
        <ConfirmPanel
          lat={center.lat}
          lng={center.lng}
          polygon={ring.map((c) => ({ lat: c[1], lng: c[0] }))}
          candidateCulture={p.culture}
          candidateConfidence={p.confidence}
          zoom={19}
        />
      )}

      <p className="text-[11px] text-muted-foreground">
        Contour suivi sur clôture visible (imagerie haute-résolution) · culture indicative Sentinel-2, validation terrain recommandée.
      </p>
    </div>
  );
}
