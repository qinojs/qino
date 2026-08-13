import * as nodePath from "node:path";

import { ai } from "../mod.ts";
import { resolve } from "./registry.ts";

import type { App, Transcript, TranscriptSegment, TranscriptWord } from "@qino/qino";

async function hasSttModel(app: App): Promise<boolean> {
  try {
    const { provider, model } = await resolve(app, { kind: "stt" });
    if (!model) return false;
    await ai(app).client(provider);
    return true;
  } catch { return false; }
}

export function registerAiTranscript(app: App): void {
  app.fileTransformer.registerTranscriptEngine({
    name: "ai-stt",
    priority: 10,
    available: () => hasSttModel(app),
    transcribe: async (mediaPath, mime) => {
      let res = await ai(app).transcription({
        file: mediaPath,
        filename: mediaName(mediaPath, mime),
        mime,
        response_format: "verbose_json",
        "timestamp_granularities[]": "word",
      }) as Record<string, unknown>;
      if (res.error) {
        res = await ai(app).transcription({ file: mediaPath, filename: mediaName(mediaPath, mime), mime }) as Record<string, unknown>;
      }
      if (res.error) throw new Error(`AI transcript: ${errText(res.error)}`);
      return normalizeTranscript(res);
    },
  });
}

function errText(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  return String((err as { message?: unknown }).message ?? JSON.stringify(err));
}

function mediaName(path: string, mime: string): string {
  const name = nodePath.basename(path);
  return /\.[a-z0-9]+$/i.test(name) ? name : `audio.${ext(mime)}`;
}

function ext(mime: string): string {
  return ({
    "audio/flac": "flac",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "video/mp4": "mp4",
    "video/webm": "webm",
  } as Record<string, string>)[mime] ?? "mp3";
}

function normalizeTranscript(raw: Record<string, unknown>): Transcript {
  const segments = openAiSegments(raw) ?? awsSegments(raw) ?? deepgramSegments(raw) ?? googleSegments(raw);
  const text = str(raw.text) ?? awsText(raw) ?? segments.map((s) => s.text).join(" ");
  return { kind: "qino.transcript", version: 1, text, language: str(raw.language), segments: segments.length ? segments : [{ text }] };
}

function openAiSegments(raw: Record<string, unknown>): TranscriptSegment[] | undefined {
  const segs = arr(raw.segments);
  if (!segs) return;
  return segs.map(obj).filter((s): s is Record<string, unknown> => !!s).map(seg).filter((s) => s.text);
}

function deepgramSegments(raw: Record<string, unknown>): TranscriptSegment[] | undefined {
  const alt = first(obj(raw.channel)?.alternatives) ?? first(first(raw.channels)?.alternatives) ?? first(first(obj(raw.results)?.channels)?.alternatives);
  if (!alt) return;
  const text = str(alt.transcript) ?? "";
  return [{ start: num(raw.start), end: num(raw.duration) === undefined ? undefined : (num(raw.start) ?? 0) + num(raw.duration)!, text, confidence: num(alt.confidence), words: words(alt.words) }];
}

function awsSegments(raw: Record<string, unknown>): TranscriptSegment[] | undefined {
  const results = obj(raw.results);
  const items = arr(results?.items);
  const audio = arr(results?.audio_segments);
  if (!items || !audio) return;
  const byId = new Map(items.map((it) => obj(it)).filter((it): it is Record<string, unknown> => !!it).map((it) => [num(it.id), it]));
  return audio.map((value) => {
    const s = obj(value) ?? {};
    return {
      start: num(s.start_time),
      end: num(s.end_time),
      text: str(s.transcript) ?? "",
      words: arr(s.items)?.map((id) => word(byId.get(num(id)))).filter((w) => w.word),
    };
  }).filter((s) => s.text);
}

function googleSegments(raw: Record<string, unknown>): TranscriptSegment[] {
  return (arr(raw.results) ?? []).map((r) => {
    const rObj = obj(r);
    const alt = first(rObj?.alternatives);
    return {
      end: seconds(str(rObj?.resultEndTime)),
      text: str(alt?.transcript) ?? "",
      confidence: num(alt?.confidence),
      words: words(alt?.words),
    };
  }).filter((s) => s.text);
}

function seg(s: Record<string, unknown>): TranscriptSegment {
  return { start: num(s.start), end: num(s.end), text: str(s.text) ?? "", speaker: str(s.speaker), confidence: num(s.confidence), notes: arr(s.notes)?.map(String), words: words(s.words) };
}

function word(value: unknown): TranscriptWord {
  const w = obj(value);
  const alt = obj(arr(w?.alternatives)?.[0]);
  return { word: str(w?.word) ?? str(w?.content) ?? str(alt?.content) ?? "", start: num(w?.start) ?? num(w?.start_time) ?? seconds(str(w?.startTime)), end: num(w?.end) ?? num(w?.end_time) ?? seconds(str(w?.endTime)), confidence: num(w?.confidence) ?? num(alt?.confidence) };
}

function words(v: unknown): TranscriptWord[] | undefined {
  return arr(v)?.map(word).filter((w) => w.word);
}

function awsText(raw: Record<string, unknown>): string | undefined {
  return str(obj(arr(obj(raw.results)?.transcripts)?.[0])?.transcript);
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? v as Record<string, unknown> : undefined;
}

function arr(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

function first(v: unknown): Record<string, unknown> | undefined {
  return obj(arr(v)?.[0]);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function seconds(v: string | undefined): number | undefined {
  return v?.endsWith("s") ? num(v.slice(0, -1)) : num(v);
}
