import { useEffect, useRef, useState } from "react";
import { ImagePlus, Camera, Plus, Maximize2, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { issueText, type LineItem, type PhotoQuality } from "@/lib/claims";
import { sevBg, sevBorder } from "./claim-ui";

type BBox = [number, number, number, number];

const SAMPLE_W = 120;
const SAMPLE_H = 90;

/** Downscaled pixel data of the photo, used to pick a visible color for hand-drawn boxes. */
function usePhotoPixels(url: string | null | undefined) {
  const [pixels, setPixels] = useState<Uint8ClampedArray | null>(null);
  useEffect(() => {
    setPixels(null);
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE_W;
        canvas.height = SAMPLE_H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
        const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
        if (!cancelled) setPixels(data);
      } catch {
        // Image can't be sampled; boxes fall back to a two-tone outline.
      }
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return pixels;
}

/** Average perceived brightness (0–1) of the photo area under the box, or null if unknown. */
export function regionLuma(pixels: Uint8ClampedArray | null, bbox: BBox): number | null {
  if (!pixels) return null;
  const [y0, x0, y1, x1] = bbox;
  const px0 = Math.floor((x0 / 1000) * SAMPLE_W), px1 = Math.max(px0 + 1, Math.ceil((x1 / 1000) * SAMPLE_W));
  const py0 = Math.floor((y0 / 1000) * SAMPLE_H), py1 = Math.max(py0 + 1, Math.ceil((y1 / 1000) * SAMPLE_H));
  let sum = 0, n = 0;
  for (let y = Math.max(0, py0); y < Math.min(SAMPLE_H, py1); y++)
    for (let x = Math.max(0, px0); x < Math.min(SAMPLE_W, px1); x++) {
      const i = (y * SAMPLE_W + x) * 4;
      sum += (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
      n++;
    }
  return n ? sum / n : null;
}

/** Dark box on light paint, light box on dark paint; two-tone when brightness is unknown. */
export function boxTone(luma: number | null): "light" | "dark" | "both" {
  if (luma == null) return "both";
  return luma < 0.5 ? "light" : "dark";
}

export function PhotoViewer({
  urls,
  items,
  numbers,
  selectedId,
  onSelect,
  quality,
  drawMode = false,
  draftBox,
  onDraw,
  onUploadSlot,
  onAddPhotos,
  canDeletePhoto,
  onDeletePhoto,
}: {
  urls: (string | null)[];
  items: LineItem[];
  numbers: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  quality?: PhotoQuality[] | undefined;
  drawMode?: boolean;
  draftBox?: { photo_index: number; bbox: BBox } | null;
  onDraw?: (photoIndex: number, bbox: BBox) => void;
  onUploadSlot?: ((index: number, file: File) => void) | undefined;
  onAddPhotos?: ((files: File[]) => void) | undefined;
  canDeletePhoto?: ((index: number) => boolean) | undefined;
  onDeletePhoto?: ((index: number) => void) | undefined;
}) {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const sel = items.find((i) => i.id === selectedId);
  useEffect(() => {
    if (sel) setActive(sel.photo_index);
  }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const pt = (e: React.MouseEvent) => {
    const r = frame.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1000, ((e.clientX - r.left) / r.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((e.clientY - r.top) / r.height) * 1000)),
    };
  };

  const url = urls[active];
  const pixels = usePhotoPixels(drawMode ? url : null);
  const q = quality?.find((p) => p.photo_index === active);
  const boxes = items.filter((i) => i.photo_index === active);
  const fileRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const liveBox: BBox | null = drag
    ? [Math.min(drag.y0, drag.y1), Math.min(drag.x0, drag.x1), Math.max(drag.y0, drag.y1), Math.max(drag.x0, drag.x1)]
    : draftBox && draftBox.photo_index === active
      ? draftBox.bbox
      : null;

  return (
    <div className="flex flex-col gap-2.5">
      <div
        ref={frame}
        className={cn(
          "relative aspect-[4/3] w-full select-none overflow-hidden rounded-xl bg-muted",
          drawMode && "cursor-crosshair ring-2 ring-ring",
        )}
        onMouseDown={(e) => {
          if (!drawMode) return;
          const p = pt(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onMouseMove={(e) => {
          if (!drag) return;
          const p = pt(e);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onMouseUp={() => {
          if (!drag) return;
          const b: BBox = [
            Math.round(Math.min(drag.y0, drag.y1)),
            Math.round(Math.min(drag.x0, drag.x1)),
            Math.round(Math.max(drag.y0, drag.y1)),
            Math.round(Math.max(drag.x0, drag.x1)),
          ];
          setDrag(null);
          if (b[2] - b[0] > 10 && b[3] - b[1] > 10) onDraw?.(active, b);
        }}
      >
        {url ? (
          <img src={url} alt={`Photo ${active + 1}`} className="pointer-events-none h-full w-full object-fill" draggable={false} />
        ) : urls.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Camera className="h-6 w-6" />
            <span className="text-xs">No photos yet — waiting for the customer to upload damage photos</span>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Camera className="h-6 w-6" />
            <span className="text-xs">Photo {active + 1} — no image uploaded</span>
            {onUploadSlot && !drawMode && (
              <button
                className="rounded-full bg-card px-3 py-1 text-xs font-medium text-primary shadow-card hover:bg-accent"
                onClick={() => fileRef.current?.click()}
              >
                Upload into this slot
              </button>
            )}
          </div>
        )}
        {boxes.map((b) => (
          <DamageBox key={b.id} item={b} n={numbers.get(b.id)} selected={b.id === selectedId} disabled={drawMode} onSelect={onSelect} />
        ))}
        {url && !drawMode && (
          <button
            type="button"
            aria-label="Expand photo"
            title="Expand photo"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
            className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-card/85 text-foreground shadow-card backdrop-blur-sm transition-colors hover:bg-card"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
        {liveBox && (() => {
          const tone = boxTone(regionLuma(pixels, liveBox));
          return (
            <div
              data-testid="drawn-box"
              data-tone={tone}
              className={cn(
                "pointer-events-none absolute border-2 border-dashed",
                tone === "light" && "border-background bg-background/15 shadow-[0_0_0_1px_var(--foreground)]",
                tone === "dark" && "border-foreground bg-foreground/10 shadow-[0_0_0_1px_var(--background)]",
                tone === "both" && "border-background bg-background/10 outline outline-1 outline-foreground",
              )}
              style={{ top: `${liveBox[0] / 10}%`, left: `${liveBox[1] / 10}%`, height: `${(liveBox[2] - liveBox[0]) / 10}%`, width: `${(liveBox[3] - liveBox[1]) / 10}%` }}
            />
          );
        })()}
        {q && !q.usable && (
          <div className="absolute left-2 top-2 rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-medium text-destructive-foreground">
            Unusable: {issueText(q.issue)}
          </div>
        )}
        {drawMode && (
          <div className="absolute bottom-2 left-2 rounded-full bg-primary px-2.5 py-0.5 text-[11px] text-primary-foreground">
            Click and drag to draw the damage area
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUploadSlot?.(active, f);
          e.target.value = "";
        }}
      />
      <input
        ref={addRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onAddPhotos?.(files);
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-4 gap-2">
        {urls.map((u, i) => {
          const qq = quality?.find((p) => p.photo_index === i);
          const count = items.filter((it) => it.photo_index === i).length;
          return (
            <div key={i} className="relative">
            <button
              onClick={() => setActive(i)}
              className={cn(
                "relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted text-[11px] text-muted-foreground transition-shadow",
                i === active ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : "hover:opacity-90",
              )}
            >
              {u ? <img src={u} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="mx-auto h-4 w-4" />}
              <span className="absolute bottom-0 left-0 right-0 flex justify-between bg-card/85 px-1.5 font-medium tabular-nums backdrop-blur-sm">
                <span>P{i + 1}</span>
                <span className={cn(qq && !qq.usable && "text-destructive")}>{qq && !qq.usable ? "✕" : count ? `${count}` : ""}</span>
              </span>
            </button>
            {u && canDeletePhoto?.(i) && (
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                title="Remove this photo you uploaded"
                onClick={() => onDeletePhoto?.(i)}
                className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-card hover:opacity-90"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            </div>
          );
        })}
        {onAddPhotos && (
          <button
            type="button"
            aria-label="Add photos"
            onClick={() => addRef.current?.click()}
            className="flex aspect-[4/3] flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-input bg-card text-[11px] font-medium text-primary transition-colors hover:bg-accent"
          >
            <Plus className="h-4 w-4" />
            Add photos
          </button>
        )}
      </div>
      <ExpandedPhoto
        open={expanded}
        onOpenChange={setExpanded}
        urls={urls}
        active={active}
        setActive={setActive}
        items={items}
        numbers={numbers}
        selectedId={selectedId}
        onSelect={onSelect}
        quality={quality}
      />
      {urls.length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          {urls.filter(Boolean).length} photo{urls.filter(Boolean).length === 1 ? "" : "s"} on file
        </p>
      )}
    </div>
  );
}

function DamageBox({ item, n, selected, disabled, onSelect }: {
  item: LineItem; n: number | undefined; selected: boolean; disabled?: boolean; onSelect: (id: string) => void;
}) {
  const [y0, x0, y1, x1] = item.bbox;
  return (
    <button
      type="button"
      aria-label={`Line item ${n ?? ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onSelect(item.id);
      }}
      onMouseDown={(e) => !disabled && e.stopPropagation()}
      className={cn(
        "absolute border-2 transition-shadow",
        sevBorder[item.severity],
        selected ? "z-10 shadow-[0_0_0_3px_var(--background),0_0_0_5px_var(--foreground)]" : "opacity-90 hover:opacity-100",
        disabled && "pointer-events-none",
      )}
      style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` }}
    >
      <span className={cn("absolute -left-0.5 -top-5 rounded-md px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground", sevBg[item.severity])}>
        {n}
      </span>
    </button>
  );
}

/** Large view of the current photo, with the same damage boxes and photo-to-photo navigation. */
function ExpandedPhoto({ open, onOpenChange, urls, active, setActive, items, numbers, selectedId, onSelect, quality }: {
  open: boolean; onOpenChange: (o: boolean) => void; urls: (string | null)[]; active: number; setActive: (i: number) => void;
  items: LineItem[]; numbers: Map<string, number>; selectedId: string | null; onSelect: (id: string) => void; quality?: PhotoQuality[] | undefined;
}) {
  const withImage = urls.map((u, i) => (u ? i : -1)).filter((i) => i >= 0);
  const pos = withImage.indexOf(active);
  const go = (d: number) => {
    if (withImage.length < 2) return;
    const next = withImage[(pos + d + withImage.length) % withImage.length];
    if (next != null) setActive(next);
  };
  const url = urls[active];
  const q = quality?.find((p) => p.photo_index === active);
  const boxes = items.filter((i) => i.photo_index === active);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none gap-3 p-4 sm:rounded-2xl"
        style={{ width: "min(94vw, calc(80vh * 4 / 3 + 2rem))" }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          if (e.key === "ArrowLeft") go(-1);
        }}
      >
        <div className="pr-10">
          <DialogTitle className="text-[17px]">Photo {active + 1}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {boxes.length ? `${boxes.length} damage area${boxes.length === 1 ? "" : "s"} · click a box to select its line item` : "No damage areas on this photo"}
            {withImage.length > 1 && " · use ← → to switch photos"}
          </DialogDescription>
        </div>
        <div className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-xl bg-muted">
          {url ? (
            <img src={url} alt={`Photo ${active + 1}, enlarged`} className="pointer-events-none h-full w-full object-fill" draggable={false} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Camera className="h-6 w-6" />
            </div>
          )}
          {boxes.map((b) => (
            <DamageBox key={b.id} item={b} n={numbers.get(b.id)} selected={b.id === selectedId} onSelect={onSelect} />
          ))}
          {q && !q.usable && (
            <div className="absolute left-2 top-2 rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-medium text-destructive-foreground">
              Unusable: {issueText(q.issue)}
            </div>
          )}
          {withImage.length > 1 && (
            <>
              <button type="button" aria-label="Previous photo" onClick={() => go(-1)} className="absolute left-2 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/85 shadow-card backdrop-blur-sm hover:bg-card">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button type="button" aria-label="Next photo" onClick={() => go(1)} className="absolute right-2 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/85 shadow-card backdrop-blur-sm hover:bg-card">
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
