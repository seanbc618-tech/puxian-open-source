/** Text-format registry, after Dolce's FormatAdapter idea (decode → parse → diagnose → loss list).
 * Each entry declares its encoding and capabilities in one place; see docs/text-formats.md. */
import { importJpwabc } from "./jpwabc-import.ts";
import { exportJpwabc } from "./jpwabc-export.ts";
import { import123, type TextImport } from "./j123-import.ts";
import { export123 } from "./j123-export.ts";
import { importFanqie, sniffFanqie } from "./fanqie-import.ts";
import { sniffAbc } from "./abc-sniff.ts";
import { retryImport } from "../lazy-retry.ts";

/** The ABC reader/writer is its own chunk, fetched only when a file or paste is ABC or on export. */
export const loadAbc = () => retryImport(() => import("./abc.ts"));
/** The iReal Pro link reader is its own chunk too, fetched only when the text holds an irealb:// link. */
export const loadIreal = () => retryImport(() => import("./ireal.ts"));
/** iReal Pro share links / exported playlist HTML. */
export const sniffIreal = (text: string) => /irealb(ook)?:\/\//.test(text);
import type { Score } from "./theory.ts";

export type TextFormatId = "jpwabc" | "123" | "fanqie" | "abc" | "ireal";

export type TextFormat = {
  id: TextFormatId;
  label: string;
  exts: string[];
  encoding: string;
  read: (bytes: Uint8Array) => TextImport | Promise<TextImport>;
  write?: (score: Score) => { bytes: Uint8Array; losses: string[] } | Promise<{ bytes: Uint8Array; losses: string[] }>;
};

export const TEXT_FORMATS: readonly TextFormat[] = [
  {
    id: "jpwabc",
    label: "JP-Word",
    exts: [".jpwabc"],
    encoding: "UTF-16LE + BOM",
    read: (bytes) => {
      const r = importJpwabc(bytes);
      // "缺少…，采用…" are defaults applied, not content lost.
      const notes = r.warnings.filter((w) => w.startsWith("缺少"));
      return { score: r.score, losses: r.warnings.filter((w) => !notes.includes(w)), notes: ["JP-Word 会替换整谱，只读单声部", ...notes] };
    },
    write: (score) => exportJpwabc(score),
  },
  { id: "123", label: "123 简谱", exts: [".123"], encoding: "UTF-8（可带 BOM）", read: (bytes) => import123(bytes), write: (score) => export123(score) },
  { id: "fanqie", label: "番茄简谱", exts: [".jps", ".fq", ".pu"], encoding: "UTF-8（可带 BOM）", read: (bytes) => importFanqie(bytes) },
  {
    id: "abc",
    label: "ABC",
    exts: [".abc"],
    encoding: "UTF-8（可带 BOM）",
    read: async (bytes) => (await loadAbc()).importAbc(bytes),
    write: async (score) => {
      const r = (await loadAbc()).exportAbc(score);
      return { bytes: new TextEncoder().encode(r.text), losses: r.losses };
    },
  },
  {
    id: "ireal",
    label: "iReal Pro 和弦谱",
    exts: [".html", ".htm"],
    encoding: "UTF-8（irealb:// 链接或 iReal 导出的歌单网页）",
    read: async (bytes) => (await loadIreal()).importIreal(bytes),
  },
];

export const TEXT_FORMAT_ACCEPT = [...TEXT_FORMATS.flatMap((f) => f.exts), ".txt"].join(",");

/** Extension first; `.txt` and unknown names are sniffed, and refused when unclear. */
export function detectTextFormat(name: string, bytes: Uint8Array): TextFormat {
  const lower = name.toLowerCase();
  const byExt = TEXT_FORMATS.find((f) => f.exts.some((e) => lower.endsWith(e)));
  if (byExt) return byExt;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return TEXT_FORMATS[0];
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 64 * 1024)).replace(/^\uFEFF/, "");
  } catch {
    throw new Error("认不出这个文本文件的编码，现有谱未更改。");
  }
  if (sniffIreal(text)) return TEXT_FORMATS[4];
  if (/^\s*\.Voice\s*$/m.test(text)) return TEXT_FORMATS[0];
  // ABC shares the X:/K: headers with 123, so letter notes decide first.
  if (!/^%123\b/m.test(text) && sniffAbc(text)) return TEXT_FORMATS[3];
  if (/^%123\b/m.test(text) || /^\s*(K|X|调|标题)[:：]/m.test(text)) return TEXT_FORMATS[1];
  if (sniffFanqie(text)) return TEXT_FORMATS[2];
  throw new Error("认不出这是哪种简谱文本（支持 JP-Word、123、番茄简谱、ABC、iReal Pro 链接），现有谱未更改。");
}

export const MAX_TEXT_SCORE_BYTES = 2 * 1024 * 1024;

export async function importTextScore(name: string, bytes: Uint8Array): Promise<TextImport & { format: TextFormat }> {
  if (bytes.byteLength > MAX_TEXT_SCORE_BYTES) throw new Error("简谱文本过大（超过 2 MB），现有谱未更改。");
  const format = detectTextFormat(name, bytes);
  return { format, ...(await format.read(bytes)) };
}

/** Sniff pasted 123 / 番茄 / JP-Word / ABC text or an iReal link the same way as a nameless `.txt` file. */
export function importTextScoreFromPaste(text: string): Promise<TextImport & { format: TextFormat }> {
  return importTextScore("pasted.txt", new TextEncoder().encode(text));
}
