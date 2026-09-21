import type { ZoneParcelsResult } from "@/lib/zone-parcels";
import type { TracingProgress } from "@/hooks/useViewportParcelTracing";

/**
 * Récapitulatif de la délimitation automatique : nombre de parcelles par
 * tranche de surface, limites de fiabilité, et attribution (image Esri,
 * modèle AGPL-3.0) — une obligation de licence, pas une option d'affichage.
 */

interface FtwParcelsPanelProps {
  result: ZoneParcelsResult | null;
  loading?: boolean;
  error?: string | null;
  /** Avancement du traçage de la zone d'analyse, ou à défaut des zones visibles à l'écran. */
  progress?: TracingProgress | null;
  /** Raison pour laquelle le traçage automatique est en pause (zoom trop faible). */
  hint?: string | null;
}

function progressLabel(progress?: TracingProgress | null): string {
  const scope = progress?.scope === "zone" ? "carrés de la zone d'analyse" : "zones de l'écran";
  const zones = progress ? ` — ${progress.done}/${progress.total} ${scope}` : "";
  return `Traçage automatique des parcelles…${zones} (30 à 60 s par zone)`;
}

export default function FtwParcelsPanel({ result, loading, error, progress, hint }: FtwParcelsPanelProps) {
  if (!result) {
    if (loading) {
      return (
        <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-sm text-white/70">
          {progressLabel(progress)}
        </div>
      );
    }
    if (error) {
      return (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      );
    }
    if (hint) {
      return (
        <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-sm text-white/70">
          {hint}
        </div>
      );
    }
    return null;
  }

  const { summary, warnings, attribution } = result;

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-white">Parcelles détectées</h3>
        <span className="text-xs tabular-nums text-white/60">
          {summary.n_parcels} · {summary.area_ha_total} ha
        </span>
      </div>

      {loading && <p className="text-[11px] text-white/60">{progressLabel(progress)}</p>}
      {!loading && hint && <p className="text-[11px] text-white/60">{hint}</p>}
      {error && <p className="text-[11px] text-red-200">{error}</p>}

      {summary.n_parcels > 0 && (
        <ul className="space-y-1 text-xs">
          {summary.by_size.map((tranche) => (
            <li key={tranche.range} className="flex justify-between text-white/80">
              <span>{tranche.range}</span>
              <span className="tabular-nums text-white/60">{tranche.n_parcels}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-3 text-[11px] text-white/70">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-white" aria-hidden /> fiable (≥ 0,5 ha)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[#ffd166]" aria-hidden /> incertain
        </span>
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1 border-t border-white/10 pt-2">
          {warnings.map((warning) => (
            <p key={warning} className="text-[11px] leading-relaxed text-amber-200/80">
              {warning}
            </p>
          ))}
        </div>
      )}

      <p className="text-[10px] leading-snug text-white/40">{attribution}</p>
    </div>
  );
}
