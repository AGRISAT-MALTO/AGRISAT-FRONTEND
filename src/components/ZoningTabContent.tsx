import jsPDF from "jspdf";
import { cn } from "@/lib/utils";
import type { ZoningResult } from "@/lib/zoning";
import { buildZoningCanvas } from "@/lib/zoning-canvas";

interface ZoningTabContentProps {
  loading: boolean;
  error: string;
  result: ZoningResult | null;
  parcelLabel: string;
  ownerName: string;
  surfaceHa: number | null;
  center: { lat: number; lng: number };
  cultureDetected: string | null;
}

function coveragePercent(areaHa: number, totalAreaHa: number): number {
  return totalAreaHa > 0 ? (areaHa / totalAreaHa) * 100 : 0;
}

function InfoLine({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium text-foreground text-right truncate", valueClassName)}>{value}</span>
    </div>
  );
}

export default function ZoningTabContent({
  loading, error, result, parcelLabel, ownerName, surfaceHa, center, cultureDetected,
}: ZoningTabContentProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2.5 py-5">
        <div className="relative w-10 h-10">
          <div className="absolute inset-0 rounded-full border-2 border-muted" />
          <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
        <span className="text-sm text-muted-foreground">Calcul des zones NDVI...</span>
        <span className="text-xs text-muted-foreground">Sentinel-2 · pixel par pixel</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-5">
        <span className="text-destructive text-sm font-medium">Erreur de zoning</span>
        <span className="text-xs text-muted-foreground text-center">{error}</span>
      </div>
    );
  }

  if (!result) return null;

  const handleExport = () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const marginX = 15;
    let y = 18;

    doc.setFontSize(16);
    doc.text("AgriSat — Zoning (VRA)", marginX, y);
    y += 7;
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(`Généré le ${new Date().toLocaleDateString("fr-FR")}`, marginX, y);
    y += 9;

    doc.setTextColor(20);
    doc.setFontSize(12);
    doc.text("Parcelle", marginX, y);
    y += 6;
    doc.setFontSize(10);
    [
      `ID : ${parcelLabel}`,
      `Agriculteur : ${ownerName || "—"}`,
      `Culture détectée : ${cultureDetected || "—"}`,
      `Superficie déclarée : ${surfaceHa != null ? `${surfaceHa} ha` : "—"}`,
      `Coordonnées : ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`,
      `Image Sentinel-2 utilisée : ${result.imageStartDate} → ${result.imageEndDate}`,
    ].forEach((line) => {
      doc.text(line, marginX, y);
      y += 5.5;
    });
    y += 4;

    const imgWidth = 85;
    const imgHeight = 55;
    if (result.thumbnail) {
      doc.addImage(`data:image/png;base64,${result.thumbnail}`, "PNG", marginX, y, imgWidth, imgHeight);
    }
    const zoningCanvas = buildZoningCanvas(result);
    if (zoningCanvas) {
      doc.addImage(zoningCanvas.toDataURL("image/png"), "PNG", marginX + imgWidth + 8, y, imgWidth, imgHeight);
    }
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text("Vue satellite", marginX, y + imgHeight + 4);
    doc.text("Zones NDVI détectées", marginX + imgWidth + 8, y + imgHeight + 4);
    y += imgHeight + 12;

    doc.setTextColor(20);
    doc.setFontSize(12);
    doc.text("Zones de végétation détectées", marginX, y);
    y += 7;

    const colX = [marginX, marginX + 62, marginX + 95, marginX + 122, marginX + 155];
    doc.setFontSize(9);
    doc.setTextColor(110);
    ["Zone", "NDVI (min–max)", "Moyenne", "Surface (ha)", "Répartition"].forEach((h, i) => doc.text(h, colX[i], y));
    y += 2;
    doc.setDrawColor(200);
    doc.line(marginX, y, marginX + 180, y);
    y += 5.5;

    doc.setFontSize(9.5);
    doc.setTextColor(20);
    result.zones.forEach((zone) => {
      const pct = coveragePercent(zone.areaHa, result.totalAreaHa);
      [
        zone.label,
        `${zone.ndviMin.toFixed(2)}–${zone.ndviMax.toFixed(2)}`,
        zone.avgNdvi != null ? zone.avgNdvi.toFixed(2) : "—",
        String(zone.areaHa),
        `${pct.toFixed(1)} %`,
      ].forEach((cell, i) => doc.text(cell, colX[i], y));
      y += 6;
    });

    y += 4;
    doc.setFontSize(10);
    doc.text(`Surface totale analysée : ${result.totalAreaHa} ha`, marginX, y);

    doc.save(`zoning-${parcelLabel}.pdf`);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        {result.thumbnail && (
          <img
            src={`data:image/png;base64,${result.thumbnail}`}
            alt="Aperçu de la parcelle"
            className="w-20 h-20 object-cover rounded-md border border-border shrink-0"
          />
        )}
        <div className="min-w-0">
          <p className="text-2xl font-bold text-foreground mono leading-none">{result.totalAreaHa} ha</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-1">Surface analysée</p>
          <p className="text-[10px] text-muted-foreground mt-1.5">{result.imageStartDate} → {result.imageEndDate}</p>
        </div>
      </div>

      <div className="rounded-md bg-muted/50 divide-y divide-border/60 mt-3.5">
        <InfoLine label="Agriculteur" value={ownerName || "—"} />
        <InfoLine label="ID parcelle" value={parcelLabel} />
        <InfoLine label="Culture détectée" value={cultureDetected || "—"} valueClassName="text-primary" />
        <InfoLine label="Coordonnées" value={`${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`} />
      </div>

      <div className="space-y-2.5 mt-4">
        {result.zones.map((zone) => {
          const pct = coveragePercent(zone.areaHa, result.totalAreaHa);
          return (
            <div key={zone.key} className="rounded-md bg-muted/50 px-2.5 py-2.5 flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: zone.color }} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-xs font-medium text-foreground truncate">{zone.label}</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  NDVI {zone.ndviMin.toFixed(2)}–{zone.ndviMax.toFixed(2)} · moy. {zone.avgNdvi != null ? zone.avgNdvi.toFixed(2) : "—"} · {zone.areaHa} ha
                </p>
              </div>
              <div className="shrink-0 rounded-md bg-background/70 px-2.5 py-1.5 text-right">
                <p className="text-sm font-bold text-foreground mono leading-none">{pct.toFixed(0)}%</p>
                <p className="text-[9px] text-muted-foreground leading-none mt-1">réparti.</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground px-0.5 mt-4">
        <span>Surface totale analysée</span>
        <span>{result.totalAreaHa} ha</span>
      </div>

      <button
        type="button"
        onClick={handleExport}
        className="w-full rounded-md bg-primary text-primary-foreground text-xs font-semibold py-2 mt-5 hover:opacity-90 transition-opacity"
      >
        Exporter (PDF)
      </button>
    </div>
  );
}
