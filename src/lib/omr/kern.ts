// Original MIT implementation. No Humdrum/Verovio code is used.
import type { musicXmlToScore as ImportMusicXml } from "../music/musicxml.ts";

const escape = (s: string) =>
  s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
type Event = { at: number; duration: number; token: string; staff: number; voice: number };
type Spine = { staff: number; voice: number; end: number; clef: string };
const DIV = 10080;
function duration(token: string): number {
  const m = token.match(/(\d+)(\.*)/);
  if (!m || /[qQ]/.test(token)) throw new Error(`暂不支持的音符时值：${token}`);
  const base = Number(m[1]);
  let value = base === 0 ? 8 : 4 / base;
  for (let i = 1; i <= m[2].length; i++) value += (base === 0 ? 8 : 4 / base) / 2 ** i;
  return value;
}
function noteXml(token: string, d: number, staff: number, voice: number): string {
  return token
    .split(" ")
    .filter(Boolean)
    .map((tone, i) => {
      const p = tone.match(/([a-gA-G])\1*([#n-]*)/);
      let pitch = "<rest/>";
      if (!tone.includes("r")) {
        if (!p) throw new Error(`读不懂识别音高：${tone}`);
        const letters = p[0].replace(/[#n-]/g, "");
        const octave = p[1] === p[1].toLowerCase() ? 3 + letters.length : 4 - letters.length;
        const alter = p[2].includes("n")
          ? 0
          : [...p[2]].reduce((a, c) => a + (c === "#" ? 1 : -1), 0);
        pitch = `<pitch><step>${p[1].toUpperCase()}</step><alter>${alter}</alter><octave>${octave}</octave></pitch>`;
      }
      const ties = `${/[[_]/.test(tone) ? '<tie type="start"/>' : ""}${/[\]_]/.test(tone) ? '<tie type="stop"/>' : ""}`;
      return `<note>${i ? "<chord/>" : ""}${pitch}<duration>${Math.round(d * DIV)}</duration>${ties}<voice>${voice}</voice><staff>${staff}</staff></note>`;
    })
    .join("");
}

export type RecoveryOptions = { recover?: boolean; labels?: string[] };

/** Strict by default. Recognition previews can explicitly recover usable prefixes. */
export function kernSystemsToMusicXml(
  systems: string[],
  title: string,
  options: RecoveryOptions = {},
): { xml: string; warnings: string[]; included: number[] } {
  if (!systems.length) throw new Error("没有可转换的识别结果。");
  let measures = "",
    measureNumber = 0;
  const warnings = new Set<string>([
    "识别结果可能有错，请逐小节对照；力度、装饰音和排版未完整保留。",
  ]);
  let previousKey = "",
    previousMeter = "";
  const included: number[] = [];
  for (const [systemIndex, source] of systems.entries()) {
    const label = options.labels?.[systemIndex] ?? `第 ${systemIndex + 1} 个系统`;
    const before = measureNumber;
    let spines: Spine[] = [],
      events: Event[] = [],
      at = 0,
      start = 0,
      nextVoice = 1,
      beats = 4,
      unit = 4,
      fifths = 0;
    let mode = "major",
      sawMeter = false,
      sawKey = false;
    const clefs = new Map<number, string>();
    let initialized = false;
    function flush() {
      if (!events.length) return;
      if (!sawMeter) warnings.add("未识别到拍号，草稿暂按 4/4，请核对。");
      if (!sawKey) warnings.add("未识别到调号，草稿暂按 C 大调，请核对。");
      const end = Math.max(...events.map((e) => e.at + e.duration));
      let body = "";
      // kern columns run bottom-to-top; MusicXML importer uses first timeline
      // as the primary voice. Emit top staff first, retaining pitches and IDs.
      const upperVoice = events
        .slice()
        .sort((a, b) => a.staff - b.staff || a.voice - b.voice)[0].voice;
      const voiceOrder = [...new Set(events.map((e) => e.voice))].sort((a, b) =>
        a === upperVoice ? -1 : b === upperVoice ? 1 : a - b,
      );
      for (const [idx, voice] of voiceOrder.entries()) {
        if (idx) body += `<backup><duration>${Math.round((end - start) * DIV)}</duration></backup>`;
        let cursor = start;
        for (const e of events.filter((e) => e.voice === voice)) {
          if (e.at > cursor + 1e-5)
            body += `<forward><duration>${Math.round((e.at - cursor) * DIV)}</duration></forward>`;
          body += noteXml(e.token, e.duration, e.staff, e.voice);
          cursor = e.at + e.duration;
        }
        if (cursor < end - 1e-5)
          body += `<forward><duration>${Math.round((end - cursor) * DIV)}</duration></forward>`;
      }
      const staffCount = Math.max(...spines.map((s) => s.staff), ...events.map((e) => e.staff));
      // Repeated system headers describe the same key/meter, not new mid-score
      // changes. Emitting them every bar would reset a user's later key edit.
      const key = `<key><fifths>${fifths}</fifths><mode>${mode}</mode></key>`;
      const meter = `<time><beats>${beats}</beats><beat-type>${unit}</beat-type></time>`;
      const attributes = `<attributes><divisions>${DIV}</divisions>${key === previousKey ? "" : key}${meter === previousMeter ? "" : meter}<staves>${staffCount}</staves>${[...clefs].map(([staff, c]) => `<clef number="${staff}"><sign>${c.startsWith("F") ? "F" : "G"}</sign><line>${c.startsWith("F") ? 4 : 2}</line></clef>`).join("")}</attributes>`;
      previousKey = key;
      previousMeter = meter;
      measures += `<measure number="${++measureNumber}">${attributes}${body}</measure>`;
      events = [];
      start = end;
      at = end;
    }
    try {
      for (const line of source.trim().split(/\r?\n/)) {
        if (!line || line.startsWith("!")) continue;
        const fields = line.split("\t");
        if (line.startsWith("**")) {
          if (
            initialized ||
            fields.some((f) => !/^\*\*(?:kern|ekern_1\.0)$/.test(f)) ||
            fields.length > 2
          )
            throw new Error("本轮仅支持一至两个初始 kern 谱表。");
          spines = fields.map((_, i) => ({
            staff: fields.length - i,
            voice: nextVoice++,
            end: 0,
            clef: i === 0 && fields.length === 2 ? "F4" : "G2",
          }));
          spines.forEach((s) => clefs.set(s.staff, s.clef));
          initialized = true;
          continue;
        }
        if (!initialized) throw new Error("识别结果缺少 **kern 表头，请重试清晰的钢琴大谱表图片。");
        if (fields.every((f) => f === "*-")) break;
        if (fields.every((f) => f.startsWith("="))) {
          flush();
          continue;
        }
        if (fields.length !== spines.length) throw new Error("识别结果的声部列数不一致，请重试。");
        if (
          fields.some((f) => f === "*^" || f === "*v" || f === "*x" || f === "*+" || f === "*-")
        ) {
          const next: Spine[] = [];
          for (let i = 0; i < fields.length; i++) {
            const f = fields[i],
              s = spines[i];
            if (f === "*^") next.push(s, { ...s, voice: nextVoice++ });
            else if (f === "*v") {
              const group = [s];
              while (fields[i + 1] === "*v") group.push(spines[++i]);
              next.push({ ...s, end: Math.max(...group.map((g) => g.end)) });
            } else if (f === "*-") {
            } else if (f === "*x" || f === "*+")
              throw new Error("暂不支持识别结果中的交换或新增谱表。");
            else next.push(s);
          }
          spines = next;
          continue;
        }
        if (line.startsWith("*")) {
          fields.forEach((f, i) => {
            if (f.startsWith("*clef")) {
              spines[i].clef = f.slice(5);
              clefs.set(spines[i].staff, f.slice(5));
            }
            const meter = f.match(/^\*M(\d+)\/(\d+)$/);
            if (/^\*[a-g][#-]?:$/.test(f)) mode = "minor";
            if (/^\*[A-G][#-]?:$/.test(f)) mode = "major";
            if (meter) {
              sawMeter = true;
              beats = +meter[1];
              unit = +meter[2];
            }
            if (f.startsWith("*k[")) {
              sawKey = true;
              fifths = (f.match(/#/g) || []).length - (f.match(/-/g) || []).length;
            }
          });
          continue;
        }
        if (fields.every((f) => f === ".")) continue;
        fields.forEach((f, i) => {
          if (f === ".") return;
          let onset = at;
          if (spines[i].end > at + 1e-5) {
            if (!options.recover) throw new Error("识别结果的节奏无法对齐，请核对原图。");
            onset = spines[i].end;
            warnings.add(
              `${label}：模型声部节奏冲突；冲突音符已顺延到本声部前音结束处，音高和时值保留，节奏必须人工校对。`,
            );
          }
          const d = duration(f);
          // Validate before staging, so a malformed token cannot poison an earlier
          // usable measure when recovery flushes the prefix.
          if (options.recover) noteXml(f, d, spines[i].staff, spines[i].voice);
          events.push({
            at: onset,
            duration: d,
            token: f,
            staff: spines[i].staff,
            voice: spines[i].voice,
          });
          spines[i].end = onset + d;
        });
        const ends = spines.map((s) => s.end).filter((t) => t > at + 1e-5);
        if (ends.length) at = Math.min(...ends);
      }
      flush();
    } catch (error) {
      if (!options.recover) throw error;
      flush();
      warnings.add(
        `${label}：${error instanceof Error ? error.message : "谱符转换失败"} 仅保留出错前可转换的音符；其余区域未导入。`,
      );
    }
    if (measureNumber > before) included.push(systemIndex);
    else if (options.recover)
      warnings.add(`${label}：没有可转换的音符，此系统未导入；已生成的原始谱符仍可查看。`);
  }
  if (!measures) throw new Error("没有识别到可导入的音符。");
  return {
    xml: `<?xml version="1.0"?><score-partwise version="3.1"><work><work-title>${escape(title)}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`,
    warnings: [...warnings],
    included,
  };
}
export function kernSystemsToScore(
  systems: string[],
  title: string,
  musicXmlToScore: typeof ImportMusicXml,
  options: RecoveryOptions = {},
) {
  const { xml, warnings, included } = kernSystemsToMusicXml(systems, title, options);
  const result = musicXmlToScore(xml, title);
  return { ...result, losses: [...warnings, ...result.losses], included };
}
