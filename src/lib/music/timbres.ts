import type { Attack } from "./expression.ts";
export const TIMBRES = {
  piano: {
    label: "钢琴",
    program: 0,
    partials: [1, 2, 3, 4, 6],
    levels: [0.62, 0.22, 0.12, 0.06, 0.035],
    attack: 0.012,
    decay: 1.6,
    release: 0.08,
    sustain: 0,
    cutoff: 18000,
  },
  electric: {
    label: "柔和电钢",
    program: 4,
    partials: [1, 2, 3, 7],
    levels: [0.65, 0.16, 0.06, 0.025],
    attack: 0.018,
    decay: 2,
    release: 0.18,
    sustain: 0,
    cutoff: 4200,
  },
  strings: {
    label: "弦乐",
    program: 48,
    partials: [1, 2, 3, 4, 5, 6],
    levels: [0.4, 0.2, 0.13, 0.1, 0.07, 0.04],
    attack: 0.12,
    decay: 0.25,
    release: 0.3,
    sustain: 0.7,
    cutoff: 5500,
  },
  flute: {
    label: "长笛",
    program: 73,
    partials: [1, 2, 3],
    levels: [0.78, 0.1, 0.025],
    attack: 0.07,
    decay: 0.16,
    release: 0.16,
    sustain: 0.8,
    cutoff: 6500,
  },
  guitar: {
    label: "拨弦（吉他）",
    program: 24,
    partials: [1, 2, 3, 4, 5],
    levels: [0.58, 0.23, 0.13, 0.07, 0.03],
    attack: 0.004,
    decay: 0.85,
    release: 0.07,
    sustain: 0,
    cutoff: 3600,
  },
  bass: {
    label: "贝斯",
    program: 33,
    partials: [1, 2, 3, 4],
    levels: [0.75, 0.23, 0.08, 0.025],
    attack: 0.008,
    decay: 1.2,
    release: 0.1,
    sustain: 0,
    cutoff: 1800,
  },
} as const;
export type Timbre = keyof typeof TIMBRES;
export function isTimbre(value: unknown): value is Timbre {
  return typeof value === "string" && Object.hasOwn(TIMBRES, value);
}
/** Relative envelope times; short notes compress the attack. Piano retains its original decay. */
export function toneEnvelope(timbre: Timbre, seconds: number, attack: Attack = "normal") {
  const p = TIMBRES[timbre];
  const duration = Number.isFinite(seconds) ? Math.max(0.04, seconds) : 0.35;
  const attackTime = Math.min(
    duration * 0.5,
    attack === "accent" ? 0.004 : attack === "legato" ? Math.max(0.04, p.attack) : p.attack,
  );
  if (!p.sustain) {
    const end = Math.max(
      attackTime + 0.02,
      Math.min(p.decay, duration + (attack === "legato" ? 0.2 : p.release)),
    );
    return {
      attack: attackTime,
      hold: attackTime,
      sustain: 1,
      end,
      stop: Math.max(end + 0.02, Math.min(p.decay + 0.2, duration + 0.45)),
    };
  }
  const hold = Math.max(attackTime, duration - Math.min(p.decay, duration * 0.4));
  return {
    attack: attackTime,
    hold,
    sustain: p.sustain,
    end: duration + p.release,
    stop: duration + p.release + 0.02,
  };
}
