// The loop as a video, with mediabunny (MPL-2.0) on the browser's WebCodecs encoders. Imported
// only when a loop is saved (save.ts), and by name, so the bundle keeps just what's used.
import { BufferTarget, CanvasSource, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat } from "mediabunny";
import type { LoopWriter } from "./save";

const FPS = 10;

export async function videoWriter(canvas: HTMLCanvasElement): Promise<LoopWriter | null> {
  const codec = await getFirstEncodableVideoCodec(["avc", "vp9", "vp8"], { width: canvas.width, height: canvas.height, quality: QUALITY_HIGH });
  if (!codec) return null;
  const mp4 = codec === "avc";
  const target = new BufferTarget();
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target });
  const source = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();
  let n = 0;
  return {
    ext: mp4 ? "mp4" : "webm",
    mime: mp4 ? "video/mp4" : "video/webm",
    label: mp4 ? "MP4" : "WebM",
    async add(ms) {
      // a steady 10 frames a second plays and edits everywhere; repeats of a frame cost next to nothing
      for (let i = Math.max(1, Math.round((ms * FPS) / 1000)); i > 0; i--) await source.add(n++ / FPS, 1 / FPS);
    },
    async finish() {
      await output.finalize();
      return new Blob([target.buffer!], { type: mp4 ? "video/mp4" : "video/webm" });
    },
    async cancel() { await output.cancel().catch(() => {}); },
  };
}
