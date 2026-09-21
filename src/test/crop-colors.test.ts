import { describe, expect, it } from "vitest";
import { cropColor, CROP_COLORS, isWaterLabel } from "@/lib/crop-colors";
import { resolveCropName } from "@/lib/map-tooltip";

describe("eau libre vs rizière", () => {
  it("colore l'eau libre en bleu profond, distinct du riz", () => {
    expect(cropColor("EAU")).toBe(CROP_COLORS.eau);
    expect(cropColor("Eau (lac / plan d'eau)")).toBe(CROP_COLORS.eau);
    expect(cropColor("Riz")).toBe(CROP_COLORS.riz);
    expect(CROP_COLORS.eau).not.toBe(CROP_COLORS.riz);
  });

  it("laisse l'eau vide : ancien Riz à NDVI très bas = zone en eau vide", () => {
    expect(resolveCropName("Riz", 8)).toBe("Zone en eau — vide");
    expect(resolveCropName("Riz", 45)).toBe("Riz");
    expect(isWaterLabel("EAU")).toBe(true);
    expect(isWaterLabel("Eau (lac / plan d'eau)")).toBe(true);
    expect(isWaterLabel("Zone en eau — vide")).toBe(true);
    expect(isWaterLabel("Riz")).toBe(false);
  });

  it("colore le bâti en gris pierre, distinct du sol nu", () => {
    expect(cropColor("BATI")).toBe(CROP_COLORS.bati);
    expect(cropColor("Bâti / urbain")).toBe(CROP_COLORS.bati);
    expect(CROP_COLORS.bati).not.toBe(CROP_COLORS.solNu);
  });
});
