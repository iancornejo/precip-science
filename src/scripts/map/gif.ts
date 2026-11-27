// The loop as a GIF, with gifenc (MIT). Imported only when a GIF is saved (save.ts).
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import type { LoopWriter } from "./save";

export async function gifWriter(canvas: HTMLCanvasElement): Promise<LoopWriter> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const gif = GIFEncoder();
  let first = true;
  return {
    ext: "gif",
    mime: "image/gif",
    label: "GIF",
    async add(ms) {
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), width, height, first ? { palette, delay: ms, repeat: 0 } : { palette, delay: ms });
      first = false;
    },
    async finish() {
      gif.finish();
      return new Blob([gif.bytes()], { type: "image/gif" });
    },
    async cancel() { /* nothing held */ },
  };
}
