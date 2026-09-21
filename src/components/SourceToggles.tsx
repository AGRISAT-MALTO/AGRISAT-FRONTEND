import { cn } from "@/lib/utils";

export type ConfirmSources = Record<string, boolean>;

export const DEFAULT_CONFIRM_SOURCES: ConfirmSources = {
  sentinel2: true,
  landsat: true,
  sentinel1: true,
  hr: true,
  meteo: true,
};

const SOURCE_LABELS: Array<{ key: string; label: string; hint: string }> = [
  { key: "sentinel2", label: "Sentinel-2", hint: "Optique 10 m" },
  { key: "landsat", label: "Landsat", hint: "Optique 30 m" },
  { key: "sentinel1", label: "Sentinel-1", hint: "Radar" },
  { key: "hr", label: "Haute-résolution", hint: "Clôtures / texture" },
  { key: "meteo", label: "Météo", hint: "Degrés-jours + pluie" },
];

interface SourceTogglesProps {
  sources: ConfirmSources;
  onChange: (next: ConfirmSources) => void;
  className?: string;
}

/** Toggles des sources indépendantes utilisées par la confirmation multi-capteurs. */
export default function SourceToggles({ sources, onChange, className }: SourceTogglesProps) {
  const toggle = (key: string) => {
    onChange({ ...sources, [key]: !sources[key] });
  };

  return (
    <div className={cn("rounded-lg border border-border/70 bg-muted/40 p-2.5 space-y-1.5", className)}>
      <p className="text-xs font-medium text-foreground">Sources de confirmation</p>
      {SOURCE_LABELS.map(({ key, label, hint }) => {
        const checked = sources[key] ?? true;
        return (
          <label key={key} className="flex items-center justify-between gap-2 text-xs cursor-pointer">
            <span className="text-muted-foreground">
              {label} <span className="opacity-70">· {hint}</span>
            </span>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(key)}
              className="h-4 w-4 accent-green-600"
            />
          </label>
        );
      })}
    </div>
  );
}
