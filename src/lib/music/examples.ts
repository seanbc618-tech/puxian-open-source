import { parseJianpu } from "./notation.ts";
import { type ChordSymbol, type KeyName, type Mode, type Score } from "./theory.ts";

export type ExampleCard = {
  id: string;
  title: string;
  /** Shown as 曲：… on the home list and in the score header. */
  composer?: string;
  /** Home-list key wording when Score.key cannot spell the usual name (谱线没有升C). */
  keyText?: string;
  key: KeyName;
  mode: Mode;
  beats: number;
  beatUnit: number;
  bpm: number;
  /** Optional lead-sheet marks, in quarter notes from the start. */
  chords?: ChordSymbol[];
  /** Full score is a lazy chunk; must not be inlined into the home bundle. */
  lazy?: true;
};

export type Example = ExampleCard & { jianpu: string };

export const EXAMPLES: Example[] = [
  {
    id: "twinkle",
    title: "小星星",
    jianpu:
      "1 1 5 5 6 6 5 - 4 4 3 3 2 2 1 - 5 5 4 4 3 3 2 - 5 5 4 4 3 3 2 - 1 1 5 5 6 6 5 - 4 4 3 3 2 2 1 -",
    key: "C",
    mode: "major",
    beats: 4,
    beatUnit: 4,
    bpm: 88,
  },
  {
    id: "tigers",
    title: "两只老虎",
    jianpu: "1 2 3 1 1 2 3 1 3 4 5 - 3 4 5 - 56 54 3 1 56 54 3 1 1 5, 1- 1 5, 1-",
    key: "C",
    mode: "major",
    beats: 4,
    beatUnit: 4,
    bpm: 104,
  },
  {
    id: "ode",
    title: "欢乐颂",
    jianpu:
      "3 3 4 5 5 4 3 2 1 1 2 3 3*1.5 2*0.5 2 - 3 3 4 5 5 4 3 2 1 1 2 3 2*1.5 1*0.5 1 -",
    key: "C",
    mode: "major",
    beats: 4,
    beatUnit: 4,
    bpm: 96,
  },
  {
    id: "four-four-study",
    title: "四拍练习",
    jianpu: "2 6 4 1 5 3 2 -",
    key: "F",
    mode: "major",
    beats: 4,
    beatUnit: 4,
    bpm: 72,
  },
  {
    id: "three-four-study",
    title: "三拍练习",
    // 两个八分音符弱起，前置两拍休止以对齐小节线。
    jianpu: "0 0 24 6 3 5 2 - 47 3 6 2 4 - 31 5 7 2 6 3 62 4 6 7 1 - -",
    key: "C",
    mode: "major",
    beats: 3,
    beatUnit: 4,
    bpm: 96,
    chords: [
      { at: 3, symbol: "C" },
      { at: 6, symbol: "G" },
      { at: 12, symbol: "C" },
      { at: 15, symbol: "C7" },
      { at: 18, symbol: "F" },
      { at: 21, symbol: "C" },
      { at: 23, symbol: "G" },
      { at: 24, symbol: "C" },
    ],
  },
];

/** id, title, composer, key+mode compact (Db-/C+), optional list wording, dummy meter lives on the card type only. */
type PdRow = [string, string, string, string, string?];
const PD_ROWS: PdRow[] = [
  ["hr2","匈牙利狂想曲第二号","李斯特","Db-","升C 小调"],
  ["elise","致爱丽丝","贝多芬","A-"],
  ["moonlight","月光奏鸣曲第一乐章","贝多芬","Db-","升C 小调"],
  ["alla-turca","土耳其进行曲","莫扎特","A-"],
  ["nachtmusik","弦乐小夜曲第一乐章","莫扎特","G+"],
  ["wtc-prelude","C 大调前奏曲","巴赫","C+"],
  ["canon","卡农","帕赫贝尔","D+"],
  ["nocturne","夜曲 Op.9 No.2","肖邦","Eb+"],
  ["gymnopedie","Gymnopédie 第一号","萨蒂","D+"],
  ["clair-de-lune","月光","德彪西","Db+"],
  ["lullaby","摇篮曲","勃拉姆斯","Eb+"],
  ["blue-danube","蓝色多瑙河","约翰·施特劳斯二世","A+"],
  ["radetzky","拉德斯基进行曲","老约翰·施特劳斯","D+"],
  ["arabesque","阿拉伯风格曲第一号","德彪西","E+"],
  ["fille","亚麻色头发的少女","德彪西","F#+"],
  ["barcarolle","船歌","奥芬巴赫","D+"],
  ["minute-waltz","小狗圆舞曲","肖邦","Db+"],
];

export const PD_EXAMPLES: ExampleCard[] = PD_ROWS.map(([id, title, composer, km, keyText]) => ({
  id, title, composer,
  key: km.slice(0, -1) as KeyName,
  mode: km.endsWith("-") ? "minor" : "major",
  beats: 4, beatUnit: 4, bpm: 60, lazy: true,
  ...(keyText ? { keyText } : {}),
}));


export const HOME_EXAMPLE_GROUPS = [
  { id: "short", label: "短曲入门" },
  { id: "classics", label: "世界名曲 · 公有领域" },
] as const;
export const HOME_EXAMPLES = [
  ...EXAMPLES.map((example) => ({ ...example, group: "short" as const })),
  ...PD_EXAMPLES.map((example) => ({ ...example, group: "classics" as const })),
];

/** Resolve examples-pd/<id>.json from the page URL so both / and /index.html work. */
export function exampleScoreUrl(id: string, baseURI: string): string {
  return new URL(`examples-pd/${encodeURIComponent(id)}.json`, baseURI).href;
}

export function scoreFromExample(example: Example): Score {
  const score: Score = {
    title: example.title,
    bpm: example.bpm,
    beats: example.beats,
    beatUnit: example.beatUnit,
    key: example.key,
    mode: example.mode,
    clef: "treble",
    tonicOctave: 4,
    notes: [],
  };
  const parsed = parseJianpu(example.jianpu, score);
  if (parsed.error) throw new Error(parsed.error);
  const next: Score = { ...score, notes: parsed.notes };
  if (example.chords?.length) next.chordSymbols = example.chords.map((item) => ({ ...item }));
  return next;
}
