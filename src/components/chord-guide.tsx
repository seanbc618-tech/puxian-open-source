import { useEffect, useMemo, useState } from "react";
import type { Score } from "@/lib/music/theory";
import type { ChordSymbol } from "@/lib/music/chord-symbol";
import {
  chordDiagram,
  currentAndNextChord,
  recommendCapo,
  type ChordInstrument,
} from "@/lib/music/chord-diagrams";
import { chordDegree } from "@/lib/music/chord-degrees";
import { stateAt } from "@/lib/music/score-timeline";
import "./chord-guide.css";
const names = { guitar: "吉他", ukulele: "尤克里里", piano: "钢琴" };
export function Diagram({
  symbol,
  instrument,
  capo = 0,
}: {
  symbol: string;
  instrument: ChordInstrument;
  capo?: number;
}) {
  const d = useMemo(() => chordDiagram(symbol, instrument, capo), [symbol, instrument, capo]);
  const strings = d.frets?.length ?? 0;
  return (
    <div className="chord-diagram" data-shape={d.shape}>
      <strong>{instrument !== "piano" && capo > 0 ? `按 ${d.shape} 型` : symbol}</strong>
      {instrument === "piano" ? (
        <svg
          viewBox="0 0 140 62"
          role="img"
          aria-label={`${symbol} 钢琴组成音 ${d.notes.join(" ")}`}
        >
          {[0, 2, 4, 5, 7, 9, 11].map((pc, i) => (
            <rect
              key={pc}
              x={i * 20}
              y={1}
              width={19}
              height={58}
              fill={d.tones.includes(pc) ? "#efc79f" : "#fffdf7"}
              stroke="#8c877d"
            />
          ))}
          {[
            [1, 14],
            [3, 34],
            [6, 74],
            [8, 94],
            [10, 114],
          ].map(([pc, x]) => (
            <rect
              key={pc}
              x={x}
              y={1}
              width={12}
              height={35}
              fill={d.tones.includes(pc) ? "#d08c54" : "#343c3b"}
            />
          ))}
        </svg>
      ) : d.frets ? (
        <svg
          viewBox={`0 0 ${strings * 18 + 12} 112`}
          role="img"
          aria-label={`${d.shape} ${names[instrument]}指法，${d.frets.map((f) => (f < 0 ? "不弹" : f + "品")).join("、")}`}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <line
              key={i}
              x1={15}
              x2={15 + (strings - 1) * 18}
              y1={22 + i * 16}
              y2={22 + i * 16}
              stroke="#8c877d"
              strokeWidth={i === 0 ? 3 : 1}
            />
          ))}
          {d.frets.map((f, i) => (
            <g key={i}>
              <line x1={15 + i * 18} x2={15 + i * 18} y1={22} y2={102} stroke="#8c877d" />
              {f > 0 ? (
                <>
                  <circle cx={15 + i * 18} cy={14 + f * 16} r={6} fill="#42685c" />
                  <text
                    x={15 + i * 18}
                    y={17 + f * 16}
                    textAnchor="middle"
                    fontSize="9"
                    fill="white"
                  >
                    {f}
                  </text>
                </>
              ) : (
                <text x={15 + i * 18} y={14} textAnchor="middle" fontSize="12">
                  {f === 0 ? "○" : "×"}
                </text>
              )}
            </g>
          ))}
        </svg>
      ) : (
        <p>仅列组成音</p>
      )}
      <small>{d.notes.length ? d.notes.join(" · ") : "暂不支持此扩展和弦的组成音"}</small>
      {d.bass ? <small>低音 {d.bass}（图示根和弦）</small> : null}
    </div>
  );
}
type Settings = { capo: number; instrument: ChordInstrument; degree: boolean; numeric: boolean };
const defaults: Settings = { capo: 0, instrument: "guitar", degree: false, numeric: false };
function load(id: string): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem("puxian-chords:" + id) ?? "null");
    return {
      capo: Number.isInteger(raw?.capo) && raw.capo >= 0 && raw.capo <= 7 ? raw.capo : 0,
      instrument: ["guitar", "ukulele", "piano"].includes(raw?.instrument)
        ? raw.instrument
        : "guitar",
      degree: raw?.degree === true,
      numeric: raw?.numeric === true,
    };
  } catch {
    return defaults;
  }
}
export default function ChordGuide({
  score,
  at,
  songId,
  onLabels,
}: {
  score: Score;
  at: number;
  songId: string;
  onLabels: (source: Score, labels: ChordSymbol[]) => void;
}) {
  const [settings, setSettings] = useState(() => load(songId));
  const { capo, instrument, degree, numeric } = settings;
  const symbols = score.chordSymbols ?? [];
  useEffect(() => {
    try {
      localStorage.setItem("puxian-chords:" + songId, JSON.stringify(settings));
    } catch {
      /* Storage can be unavailable. */
    }
  }, [songId, settings]);
  useEffect(() => {
    onLabels(
      score,
      (score.chordSymbols ?? []).map((m) => {
        const s = stateAt(score, m.at);
        const d = chordDegree(m.symbol, s.key, s.mode, numeric);
        return { ...m, symbol: degree ? `${d} · ${m.symbol}` : `${m.symbol} · ${d}` };
      }),
    );
  }, [score, degree, numeric, onLabels]);
  const window = currentAndNextChord(symbols, at);
  const pair = [window.current, window.next];
  const update = (value: Partial<Settings>) => setSettings((s) => ({ ...s, ...value }));
  return (
    <section className="chord-guide no-print" aria-label="和弦按法与级数">
      <details>
        <summary>
          和弦图 · {names[instrument]} · {capo ? `变调夹 ${capo} 品` : "无变调夹"}
        </summary>
        <div className="chord-controls">
          <label>
            乐器{" "}
            <select
              aria-label="和弦图乐器"
              value={instrument}
              onChange={(e) => update({ instrument: e.target.value as ChordInstrument })}
            >
              {Object.entries(names).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            变调夹{" "}
            <select
              aria-label="变调夹品位"
              value={capo}
              onChange={(e) => update({ capo: Number(e.target.value) })}
            >
              {Array.from({ length: 8 }, (_, i) => (
                <option key={i} value={i}>
                  {i} 品
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => update({ capo: recommendCapo(symbols.map((s) => s.symbol)) })}
          >
            推荐
          </button>
          <label>
            主标签{" "}
            <select
              aria-label="和弦主标签"
              value={degree ? "degree" : "name"}
              onChange={(e) => update({ degree: e.target.value === "degree" })}
            >
              <option value="name">和弦名（级数副标签）</option>
              <option value="degree">级数（和弦名副标签）</option>
            </select>
          </label>
          <label>
            级数格式{" "}
            <select
              aria-label="级数格式"
              value={numeric ? "number" : "roman"}
              onChange={(e) => update({ numeric: e.target.value === "number" })}
            >
              <option value="roman">罗马数字</option>
              <option value="number">简谱数字</option>
            </select>
          </label>
        </div>
        <p>变调夹只改变弦乐器按法，谱子与播放音高不变。钢琴显示实际音高。</p>
        <details>
          <summary>全部和弦图（{symbols.length} 处）</summary>
          <div className="chord-all">
            {symbols.map((s) => (
              <div key={s.at}>
                <small>第 {s.at + 1} 四分拍</small>
                <Diagram symbol={s.symbol} instrument={instrument} capo={capo} />
              </div>
            ))}
          </div>
        </details>
      </details>
      <div className="chord-pair" aria-live="off">
        {!window.current ? <small>当前还没有和弦</small> : null}
        {pair.map((s, i) => {
          if (!s) return null;
          const state = stateAt(score, s.at),
            d = chordDegree(s.symbol, state.key, state.mode, numeric);
          return (
            <div key={s.at} data-chord-position={i === 0 ? "current" : "next"}>
              <small>
                {i === 0 ? "当前和弦" : "下一个和弦"} · {degree ? d : s.symbol}{" "}
                <span>（{degree ? s.symbol : d}）</span>
              </small>
              <Diagram symbol={s.symbol} instrument={instrument} capo={capo} />
            </div>
          );
        })}
        {!window.next ? <small>已是最后一个和弦</small> : null}
      </div>
    </section>
  );
}
