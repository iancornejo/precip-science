// gifenc (MIT, github.com/mattdesl/gifenc) ships no types; the parts save.ts uses.
declare module "gifenc" {
  export type GifPalette = number[][];
  type Format = "rgb565" | "rgb444" | "rgba4444";
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: Format }): GifPalette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: Format): Uint8Array;
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number,
      opts?: { palette?: GifPalette; delay?: number; repeat?: number; transparent?: boolean; dispose?: number }): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  }
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder;
}
