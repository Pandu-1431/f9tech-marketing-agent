import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { ffmpegPath } from "@/lib/config";

const run = promisify(execFile);

export async function ffmpeg(args: string[]): Promise<void> {
  try {
    await run(ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60_000 });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`ffmpeg failed: ${(e.stderr || e.message).slice(-600)}`);
  }
}

export async function tempDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `reel-${crypto.randomUUID()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Convert any audio (mp3, wav, ...) to 24 kHz mono 16-bit WAV. */
export async function toWav(audio: Buffer): Promise<Buffer> {
  const dir = await tempDir();
  try {
    const src = path.join(dir, "in.bin");
    const dst = path.join(dir, "out.wav");
    await fs.writeFile(src, audio);
    await ffmpeg(["-i", src, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", dst]);
    return await fs.readFile(dst);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Duration of a PCM WAV in seconds (reads the header). */
export function wavDurationSec(wav: Buffer): number {
  const byteRate = wav.readUInt32LE(28);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "data") return Math.min(size, wav.length - offset - 8) / byteRate;
    offset += 8 + size;
  }
  return 0;
}

export function silentWav(seconds: number, rate = 24000): Buffer {
  const pcm = Buffer.alloc(Math.round(seconds * rate) * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
