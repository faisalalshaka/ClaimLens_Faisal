import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildCostTable, type Claim, type RepairCost } from "./claims";

export const claimsQuery = queryOptions({
  queryKey: ["claims"],
  queryFn: async () => {
    const { data, error } = await supabase.from("claims").select("*").order("created_at");
    if (error) throw error;
    return data as unknown as Claim[];
  },
});

export const claimQuery = (id: string) =>
  queryOptions({
    queryKey: ["claim", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("claims").select("*").eq("id", id).single();
      if (error) throw error;
      return data as unknown as Claim;
    },
  });

export const costsQuery = queryOptions({
  queryKey: ["repair_costs"],
  staleTime: Infinity,
  queryFn: async () => {
    const { data, error } = await supabase.from("repair_costs").select("*");
    if (error) throw error;
    return buildCostTable(data as unknown as RepairCost[]);
  },
});

export const photoUrlsQuery = (paths: (string | null)[]) =>
  queryOptions({
    queryKey: ["photo-urls", paths],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const real = paths.filter((p): p is string => !!p);
      if (!real.length) return paths.map(() => null);
      const { data } = await supabase.storage.from("claim-photos").createSignedUrls(real, 3600);
      const map = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
      return paths.map((p) => (p ? (map.get(p) ?? null) : null));
    },
  });

const MAX_PHOTO_SIDE = 2048;

/** Re-encode any browser-viewable image (AVIF, HEIC on Safari, etc.) as a JPEG the AI can read. */
async function toJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (!blob) throw new Error("encode failed");
    return blob;
  } catch {
    throw new Error(`"${file.name}" isn't a photo format this browser can open. Please use a JPG or PNG.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPhoto(claimId: string, file: File): Promise<string> {
  const jpeg = await toJpeg(file);
  const path = `${claimId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error } = await supabase.storage.from("claim-photos").upload(path, jpeg, { contentType: "image/jpeg" });
  if (error) throw error;
  return path;
}

/** Repair shop quote document (PDF or image), kept as-is for the agent to read. Never sent to the AI. */
export async function uploadQuote(claimId: string, file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("The quote file is larger than 10 MB.");
  const ext = (file.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `quotes/${claimId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await supabase.storage.from("claim-photos").upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  return path;
}

export async function quoteFileUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("claim-photos").createSignedUrl(path, 3600);
  if (error || !data) throw error ?? new Error("Could not open the quote file.");
  return data.signedUrl;
}

export async function updateClaim(id: string, patch: Partial<Claim>) {
  const { error } = await supabase
    .from("claims")
    .update({ ...(patch as Record<string, unknown>), updated_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) throw error;
}
