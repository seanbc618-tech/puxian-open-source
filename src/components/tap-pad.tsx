import { clsx } from "clsx";
import { Delete } from "lucide-react";
import { TAP_DURATIONS, TAP_OCTAVE_MAX, TAP_OCTAVE_MIN, type TapAccidental } from "@/lib/music/tap-entry";
import { tapHaptic } from "@/lib/music/tap-feedback";

export type TapPadProps = {
  duration: number;
  dotted: boolean;
  octave: number;
  accidental: TapAccidental;
  audition: boolean;
  stack: boolean;
  cursorLabel: string;
  canBackspace: boolean;
  atEnd: boolean;
  onDuration: (value: number) => void;
  onDotted: () => void;
  onOctave: (delta: number) => void;
  onAccidental: (value: TapAccidental) => void;
  onAudition: () => void;
  onStack: () => void;
  onDigit: (degree: number) => void;
  onBackspace: () => void;
  onEnd: () => void;
};

const OCTAVE_NAMES: Record<number, string> = { [-2]: "低两个八度", [-1]: "低八度", 0: "中音区", 1: "高八度", 2: "高两个八度" };

function Dots({ count }: { count: number }) {
  return <span className="tap-dots" aria-hidden="true">{"•".repeat(Math.abs(count))}</span>;
}

/** Phone-friendly numbered-notation keypad. Every target is at least 44px. */
export function TapPad(props: TapPadProps) {
  const { octave, accidental } = props;
  const prefix = accidental === 1 ? "#" : accidental === -1 ? "b" : "";
  return (
    <section className="tap-pad" aria-label="点按键盘" onClick={(event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (button && !button.disabled) tapHaptic();
    }}>
      <div className="tap-row" role="group" aria-label="时值">
        <div className="segmented tap-durations">
          {TAP_DURATIONS.map((item) => (
            <button key={item.value} type="button" aria-pressed={props.duration === item.value}
              onClick={() => props.onDuration(item.value)}>{item.label}</button>
          ))}
        </div>
        <button type="button" className="tap-toggle" aria-pressed={props.dotted} onClick={props.onDotted}>附点</button>
      </div>
      <div className="tap-row" role="group" aria-label="八度与升降">
        <button type="button" className="tap-toggle" disabled={octave <= TAP_OCTAVE_MIN}
          onClick={() => props.onOctave(-1)}>低八度</button>
        <span className="tap-octave" role="status" aria-label="当前八度">{OCTAVE_NAMES[octave]}</span>
        <button type="button" className="tap-toggle" disabled={octave >= TAP_OCTAVE_MAX}
          onClick={() => props.onOctave(1)}>高八度</button>
        <button type="button" className="tap-toggle" aria-label="升号" aria-pressed={accidental === 1}
          onClick={() => props.onAccidental(accidental === 1 ? 0 : 1)}>#</button>
        <button type="button" className="tap-toggle" aria-label="降号" aria-pressed={accidental === -1}
          onClick={() => props.onAccidental(accidental === -1 ? 0 : -1)}>b</button>
        <button type="button" className="tap-toggle" aria-pressed={props.audition} onClick={props.onAudition}>试听</button>
        <button type="button" className="tap-toggle" aria-pressed={props.stack} onClick={props.onStack}>叠和弦</button>
      </div>
      <div className="tap-keys">
        {[1, 2, 3, 4, 5, 6, 7].map((degree) => (
          <button key={degree} type="button" className="tap-key" aria-label={`唱名 ${prefix}${degree}`}
            onClick={() => props.onDigit(degree)}>
            {octave > 0 ? <Dots count={octave} /> : null}
            <span className="tap-digit">{prefix ? <small>{prefix}</small> : null}{degree}</span>
            {octave < 0 ? <Dots count={octave} /> : null}
          </button>
        ))}
        <button type="button" className="tap-key" aria-label="休止 0" onClick={() => props.onDigit(0)}>
          <span className="tap-digit">0</span><span className="tap-sub">休止</span>
        </button>
        <button type="button" className={clsx("tap-key tap-wide")} aria-label="退格" disabled={!props.canBackspace}
          onClick={props.onBackspace}>
          <Delete className="size-5" aria-hidden="true" /><span className="tap-sub">退格</span>
        </button>
        <button type="button" className="tap-key tap-wide" disabled={props.atEnd} onClick={props.onEnd}>
          <span className="tap-sub">光标到末尾</span>
        </button>
      </div>
      <p className="mt-2 text-sm text-muted" role="status">
        {props.cursorLabel}。点谱面上的音，新音就插在它后面。
        {props.stack ? "已打开叠和弦：第一下新起一组，接着点的音叠在同一拍。" : "点「叠和弦」可把几个音叠在同一拍。"}
        {octave !== 0 ? "八度只作用于下一个音，写下后会回到中音区。" : ""}
      </p>
    </section>
  );
}
