import { cropColor, cropLabel, type ZoneCropsResult } from "@/lib/zone-crops";

/**
 * Panneau recapitulatif des cultures d'une zone d'analyse.
 *
 * Affiche la repartition par culture et, surtout, les avertissements renvoyes
 * par l'API. Ces avertissements ne sont pas decoratifs : ils disent que la base
 * ne couvre qu'environ 2 % des parcelles d'une zone et que l'orge n'est pas
 * detectable. Les masquer laisserait croire a une carte exhaustive.
 */

interface ZoneCropsPanelProps {
  result: ZoneCropsResult | null;
  loading?: boolean;
  error?: string | null;
}

export default function ZoneCropsPanel({ result, loading, error }: ZoneCropsPanelProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/40 p-4 text-sm text-white/70">
        Analyse des cultures en cours…
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

  if (!result) return null;

  const { summary, warnings, query } = result;

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-black/40 p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-white">Cultures de la zone</h3>
        <span className="text-xs text-white/50">
          rayon {query.radius_m >= 1000
            ? `${(query.radius_m / 1000).toFixed(1)} km`
            : `${query.radius_m} m`}
        </span>
      </div>

      {summary.n_parcels === 0 ? (
        <p className="text-sm text-white/70">
          Aucune parcelle relevée dans ce rayon. Essayez 1 à 2 km.
        </p>
      ) : (
        <>
          <p className="text-xs text-white/60">
            {summary.n_parcels} parcelles · {summary.area_ha_total} ha
          </p>

          <ul className="space-y-1.5">
            {summary.crops.map((entry) => {
              const share = summary.n_parcels
                ? Math.round((100 * entry.n_parcels) / summary.n_parcels)
                : 0;
              return (
                <li key={entry.crop} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm"
                    style={{ backgroundColor: cropColor(entry.crop) }}
                    aria-hidden
                  />
                  <span className="flex-1 text-white/85">{cropLabel(entry.crop)}</span>
                  <span className="tabular-nums text-white/60">
                    {entry.n_parcels} · {entry.area_ha} ha · {share}%
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1 border-t border-white/10 pt-2">
          {warnings.map((warning) => (
            <p key={warning} className="text-[11px] leading-relaxed text-amber-200/80">
              {warning}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
