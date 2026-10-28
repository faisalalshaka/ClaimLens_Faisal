import { describe, expect, it } from "vitest";
import { applyContextRecheck, intakeContextChanged, mergeAddedPhotoResult, removePhoto, vehicleMismatchText, type AiResult } from "./claims";

const base: AiResult = { photo_quality: [], can_assess: true, requires_inspection: false, requires_inspection_reason: null, analyzed_photos: ["a", "b"] };

describe("vehicle mismatch warning", () => {
  it("names each mismatched photo by its number on the claim", () => {
    const ai = { ...base, vehicle_mismatch: true, vehicle_mismatches: [{ path: "d", reason: "shows a BMW" }, { path: "c", reason: "Shows a purple hatchback." }] };
    expect(vehicleMismatchText(ai, ["a", "b", "c", "d"])).toBe("Photo 3 shows a purple hatchback; Photo 4 shows a BMW");
  });

  it("keeps earlier mismatches when another photo is added", () => {
    const prev = { ...base, vehicle_mismatch: true, vehicle_mismatches: [{ path: "c", reason: "shows a hatchback" }] };
    const merged = mergeAddedPhotoResult(prev, { ...base, vehicle_mismatch: true, vehicle_mismatch_reason: null, vehicle_mismatches: [{ path: "d", reason: "shows a BMW" }] }, ["a", "b", "c", "d"], ["d"]);
    expect(merged.vehicle_mismatches?.map((m) => m.path)).toEqual(["c", "d"]);
  });

  it("disappears when the mismatched photo is removed", () => {
    const ai = { ...base, added_photos: ["c"], vehicle_mismatch: true, vehicle_mismatches: [{ path: "c", reason: "shows a BMW" }] };
    const after = removePhoto({ photos: ["a", "b", "c"], ai_result: ai, line_items: [], ai_line_items: [] }, 2);
    expect(vehicleMismatchText(after.ai_result, after.photos)).toBeNull();
  });
});

describe("re-check after editing intake details", () => {
  const intake = { description: "Trunk damage backing out", vehicle_year: 2015, vehicle_make: "BMW", vehicle_model: "1 Series" };

  it("is needed when the description or vehicle changes", () => {
    expect(intakeContextChanged(intake, { ...intake, description: "Front damage from speeding out of garage" })).toBe(true);
    expect(intakeContextChanged(intake, { ...intake, vehicle_make: "Toyota" })).toBe(true);
    expect(intakeContextChanged(intake, { ...intake, vehicle_year: 2016 })).toBe(true);
  });

  it("is not needed for whitespace or letter-case edits", () => {
    expect(intakeContextChanged(intake, { ...intake, description: "  trunk damage  backing out " })).toBe(false);
  });

  it("replaces the old description warning and keeps the rest of the AI result", () => {
    const prev = { ...base, requires_inspection: true, requires_inspection_reason: "Severe front-end deformation", narrative_mismatch: true, narrative_mismatch_reason: "Described trunk damage, photos show front damage" };
    const next = applyContextRecheck(prev, { narrative_mismatch: false, narrative_mismatch_reason: "ignored", vehicle_mismatches: [] });
    expect(next.narrative_mismatch).toBe(false);
    expect(next.narrative_mismatch_reason).toBeNull();
    expect(next.requires_inspection).toBe(true);
    expect(next.analyzed_photos).toEqual(["a", "b"]);
  });

  it("replaces old vehicle warnings with the re-checked ones", () => {
    const prev = { ...base, vehicle_mismatch: true, vehicle_mismatches: [{ path: "a", reason: "shows a BMW" }] };
    const next = applyContextRecheck(prev, { narrative_mismatch: false, narrative_mismatch_reason: null, vehicle_mismatches: [] });
    expect(vehicleMismatchText(next, ["a", "b"])).toBeNull();
  });
});
