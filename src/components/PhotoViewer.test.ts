import { describe, expect, it } from "vitest";
import { boxTone, regionLuma } from "./PhotoViewer";

const fill = (v: number) => new Uint8ClampedArray(120 * 90 * 4).fill(v);

describe("drawn box contrast", () => {
  it("uses a light box on a black car", () => {
    expect(boxTone(regionLuma(fill(15), [100, 100, 600, 600]))).toBe("light");
  });
  it("keeps the dark box on a white car", () => {
    expect(boxTone(regionLuma(fill(240), [100, 100, 600, 600]))).toBe("dark");
  });
  it("falls back to a two-tone box when the photo can't be read", () => {
    expect(boxTone(regionLuma(null, [0, 0, 500, 500]))).toBe("both");
  });
});
