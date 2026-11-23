import { gunzipSync, strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";
import { cleanScore } from "./expression.ts";
import { isScore } from "./score-storage.ts";
import type { NoteLyric, Score, ScoreNote } from "./theory.ts";

/** Keep share URLs short enough for common messengers and browser bars. */
export const MAX_SHARE_URL_LENGTH = 8_000;
export const SHARE_PREFIX = "s=";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(payload: string): Uint8Array {
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
  const aligned = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(aligned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Compact form (v2): each voice is one string of tokens, `60,64,67/2` = that chord for two quarters;
 * a token without `/` keeps the previous length, `r` is a rest. Lyrics and any other note fields ride
 * beside it by note index, so nothing in the score is dropped.
 */
type PackedVoice = { t: string; l?: (string | NoteLyric | 0)[]; x?: Record<string, Partial<ScoreNote>> };
type PackedScore = Record<string, unknown> & { v: 2; n: PackedVoice; w?: PackedVoice; e?: PackedVoice[] };

/** Header fields every score has; a value equal to the default is left out of the link. */
const META_DEFAULTS = { beats: 4, beatUnit: 4, key: "C", mode: "major", clef: "treble", tonicOctave: 4 } as const;
/** Short names for the header fields; anything else keeps its own name. */
const META_SHORT: Record<string, string> = {
  title: "T", bpm: "b", beats: "B", beatUnit: "U", key: "k", mode: "o", clef: "c", tonicOctave: "O", chordSymbols: "C",
};
const META_LONG = Object.fromEntries(Object.entries(META_SHORT).map(([long, short]) => [short, long]));

function packMeta(meta: Omit<Score, "notes" | "voice2" | "extraVoices">): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    if (name in META_DEFAULTS && META_DEFAULTS[name as keyof typeof META_DEFAULTS] === value) continue;
    let packed: unknown = value;
    // "3:C 6:G7" when every mark is a plain {at, symbol} without spaces.
    if (name === "chordSymbols" && Array.isArray(value)) {
      const marks = value as { at: unknown; symbol: unknown }[];
      if (marks.every((c) => c && Object.keys(c).length === 2 && Number.isFinite(c.at) && typeof c.symbol === "string" && /^[^\s:]+$/.test(c.symbol)))
        packed = marks.map((c) => `${c.at}:${c.symbol}`).join(" ");
    }
    out[META_SHORT[name] ?? name] = packed;
  }
  return out;
}

function unpackMeta(packed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...META_DEFAULTS };
  for (const [name, value] of Object.entries(packed)) {
    if (name === "__proto__" || name === "constructor" || name === "prototype") continue;
    const long = META_LONG[name] ?? name;
    if (long === "chordSymbols" && typeof value === "string") {
      out.chordSymbols = value ? value.split(" ").map((item) => {
        const cut = item.indexOf(":");
        return { at: Number(item.slice(0, cut)), symbol: item.slice(cut + 1) };
      }) : [];
    } else {
      out[long] = value;
    }
  }
  return out;
}

function packVoice(notes: readonly ScoreNote[]): PackedVoice {
  const tokens: string[] = [];
  const lyrics: (string | NoteLyric | 0)[] = [];
  const extras: Record<string, Partial<ScoreNote>> = {};
  let dur = 1;
  notes.forEach((note, index) => {
    const { pitches, dur: length, lyric, ...rest } = note;
    let token = pitches.length ? pitches.join(",") : "r";
    if (length !== dur) {
      token += `/${length}`;
      dur = length;
    }
    tokens.push(token);
    const plain = lyric && lyric.syllabic === "single" && Object.keys(lyric).length === 2;
    lyrics.push(lyric ? (plain ? lyric.text : lyric) : 0);
    if (Object.keys(rest).length) extras[index] = rest;
  });
  const out: PackedVoice = { t: tokens.join(" ") };
  while (lyrics.length && lyrics[lyrics.length - 1] === 0) lyrics.pop();
  if (lyrics.length) out.l = lyrics;
  if (Object.keys(extras).length) out.x = extras;
  return out;
}

function unpackVoice(packed: PackedVoice): ScoreNote[] {
  if (!packed || typeof packed.t !== "string") throw new Error("bad voice");
  let dur = 1;
  const tokens = packed.t ? packed.t.split(" ") : [];
  return tokens.map((token, index) => {
    const [head, length] = token.split("/");
    if (length != null) dur = Number(length);
    const pitches = head === "r" ? [] : head.split(",").map(Number);
    const note: ScoreNote = { ...(packed.x?.[index] ?? {}), pitches, dur };
    const lyric = packed.l?.[index];
    if (typeof lyric === "string") note.lyric = { text: lyric, syllabic: "single" };
    else if (lyric && typeof lyric === "object") note.lyric = lyric;
    return note;
  });
}

/** Compress a score into the `#s=` payload (no leading prefix). */
export function encodeSharePayload(score: Score): string {
  const { notes, voice2, extraVoices, ...meta } = score;
  const packed: PackedScore = { v: 2, ...packMeta(meta), n: packVoice(notes), ...(voice2 ? { w: packVoice(voice2) } : {}), ...(extraVoices ? { e: extraVoices.map(packVoice) } : {}) };
  return toBase64Url(zlibSync(strToU8(JSON.stringify(packed)), { level: 9 }));
}

function unpackScore(data: unknown): unknown {
  if (!data || typeof data !== "object" || (data as { v?: unknown }).v !== 2) return data;
  const { v: _v, n, w, e, ...meta } = data as PackedScore;
  void _v;
  return { ...unpackMeta(meta), notes: unpackVoice(n), ...(w ? { voice2: unpackVoice(w) } : {}), ...(e !== undefined ? { extraVoices: Array.isArray(e) && e.length <= 14 ? e.map(unpackVoice) : null } : {}) };
}

/** Inflate and validate a `#s=` payload. Invalid or hostile input returns null. */
export function decodeSharePayload(payload: string): Score | null {
  if (!payload || payload.length > MAX_SHARE_URL_LENGTH) return null;
  try {
    const bytes = fromBase64Url(payload);
    // Links made before the compact form are gzip (1f 8b); zlib (78 xx) is 12 bytes leaner and still checksummed.
    const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const json = strFromU8(gz ? gunzipSync(bytes) : unzlibSync(bytes));
    const data: unknown = unpackScore(JSON.parse(json));
    if (isScore(data)) return data;
    const cleaned = cleanScore(data as Score);
    return isScore(cleaned) ? cleaned : null;
  } catch {
    return null;
  }
}

export function parseShareHash(hash: string): Score | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(SHARE_PREFIX)) return null;
  try {
    return decodeSharePayload(decodeURIComponent(raw.slice(SHARE_PREFIX.length)));
  } catch {
    return null;
  }
}

export type ShareLink =
  | { ok: true; url: string }
  | { ok: false; tooLong: true; length: number };

/** Build a same-origin hash URL. The score never leaves the device that opens it. */
export function shareUrlOf(score: Score, base?: string): ShareLink {
  const payload = encodeSharePayload(score);
  const root = new URL(base ?? (typeof location !== "undefined" ? location.href : "https://818189.xyz/"));
  root.hash = `${SHARE_PREFIX}${payload}`;
  const url = root.href;
  if (url.length > MAX_SHARE_URL_LENGTH) return { ok: false, tooLong: true, length: url.length };
  return { ok: true, url };
}

/** Drop a `#s=` hash without navigating, so returning home or saving a copy does not reopen the share. */
export function clearShareHash(): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  if (!location.hash.startsWith(`#${SHARE_PREFIX}`)) return;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}
