import { useEffect, useRef, useState } from "react";
import { Check, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { computeSurfaceHa } from "@/lib/geo";
import type { LatLng, OutlineStyle } from "@/lib/outline-corrections";

/**
 * Correction à la main d'un contour tracé automatiquement.
 *
 * Le contour devient éditable (poignées Google Maps) avec le style de la
 * parcelle cliquée, dont l'original est masqué le temps de l'édition : glisser
 * un sommet le déplace, glisser le point au milieu d'un côté ajoute un sommet,
 * clic droit sur un sommet le supprime. « Enregistrer » renvoie la nouvelle
 * forme, enregistrée telle quelle en base, sans analyse.
 */

interface ParcelOutlineEditorProps {
  map: google.maps.Map | null;
  initialPoints: LatLng[];
  style: OutlineStyle;
  initialOwnerName?: string;
  initialNotes?: string;
  onSave: (points: LatLng[], ownerName: string, notes: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}

export default function ParcelOutlineEditor({
  map,
  initialPoints,
  style,
  initialOwnerName = "",
  initialNotes = "",
  onSave,
  onDelete,
  onCancel,
}: ParcelOutlineEditorProps) {
  const polygonRef = useRef<google.maps.Polygon | null>(null);
  const [points, setPoints] = useState<LatLng[]>(initialPoints);
  const [ownerName, setOwnerName] = useState(initialOwnerName);
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(points, ownerName.trim(), notes.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!onDelete || !window.confirm("Supprimer définitivement cette parcelle ?")) return;
    setSaving(true);
    setError("");
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Suppression impossible");
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!map) return;
    const polygon = new google.maps.Polygon({
      paths: initialPoints,
      editable: true,
      ...style,
      zIndex: 50,
      map,
    });
    polygonRef.current = polygon;

    const path = polygon.getPath();
    const sync = () => setPoints(path.getArray().map((p) => ({ lat: p.lat(), lng: p.lng() })));
    const listeners = [
      path.addListener("set_at", sync),
      path.addListener("insert_at", sync),
      path.addListener("remove_at", sync),
      polygon.addListener("rightclick", (e: google.maps.PolyMouseEvent) => {
        if (e.vertex != null && path.getLength() > 3) path.removeAt(e.vertex);
      }),
    ];

    const bounds = new google.maps.LatLngBounds();
    initialPoints.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 80);

    return () => {
      listeners.forEach((listener) => google.maps.event.removeListener(listener));
      polygon.setMap(null);
      polygonRef.current = null;
    };
  }, [map, initialPoints, style]);

  // On vide et remplit le chemin existant plutôt que setPath, qui le remplacerait
  // et détacherait les écouteurs posés dessus.
  const reset = () => {
    const path = polygonRef.current?.getPath();
    if (!path) return;
    path.clear();
    initialPoints.forEach((point) => path.push(new google.maps.LatLng(point.lat, point.lng)));
  };

  const surfaceHa = Math.round(computeSurfaceHa(points) * 100) / 100;

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[810] analysis-popup p-4 w-80 max-w-[90vw] space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Corriger le contour</p>
        <p className="text-xs text-muted-foreground mt-1">
          Glissez un sommet pour le déplacer, le point au milieu d'un côté pour en ajouter un,
          clic droit sur un sommet pour le supprimer.
        </p>
        <p className="text-xs text-foreground mt-1">{surfaceHa} ha · {points.length} pts</p>
      </div>
      <Input
        placeholder="Nom du propriétaire"
        value={ownerName}
        onChange={(e) => setOwnerName(e.target.value)}
        className="bg-background/50 text-sm h-9"
      />
      <Textarea
        placeholder="Notes sur la parcelle..."
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="bg-background/50 text-sm min-h-[60px]"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        {onDelete && (
          <Button onClick={remove} size="sm" variant="destructive" title="Supprimer cette parcelle" disabled={saving}>
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
        <Button onClick={save} size="sm" className="flex-1 gap-2" disabled={points.length < 3 || saving}>
          <Check className="w-4 h-4" />
          {saving ? "Enregistrement..." : "Enregistrer"}
        </Button>
        <Button onClick={reset} size="sm" variant="outline" title="Revenir au contour tracé" disabled={saving}>
          <Undo2 className="w-4 h-4" />
        </Button>
        <Button onClick={onCancel} size="sm" variant="outline" title="Annuler" disabled={saving}>
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
