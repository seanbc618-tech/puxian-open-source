import { isTimbre, TIMBRES, type Timbre } from "./timbres.ts";
export type MixerChannel = {
  volume: number;
  mute: boolean;
  solo: boolean;
  pan: number;
  timbre: Timbre;
  timbreChanged?: true;
};
export const defaultChannel = (): MixerChannel => ({
  volume: 100,
  mute: false,
  solo: false,
  pan: 0,
  timbre: "piano",
});
/** Voice indexes follow the score; missing/new rows default, removed rows disappear. Invalid fields are discarded. */
export function alignMixer(value: unknown, count: number): MixerChannel[] {
  const rows = Array.isArray(value) ? value : [];
  return Array.from(
    { length: Number.isFinite(count) ? Math.max(0, Math.min(16, Math.floor(count))) : 0 },
    (_, i) => {
      const raw = rows[i] && typeof rows[i] === "object" ? rows[i] : {};
      const bounded = (v: unknown, min: number, max: number, fallback: number) =>
        typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
      const timbre = isTimbre(raw.timbre) ? raw.timbre : "piano";
      return {
        volume: bounded(raw.volume, 0, 100, 100),
        mute: raw.mute === true,
        solo: raw.solo === true,
        pan: bounded(raw.pan, -100, 100, 0),
        timbre,
        ...(raw.timbreChanged === true && isTimbre(raw.timbre)
          ? { timbreChanged: true as const }
          : {}),
      };
    },
  );
}
/** Apply AFTER the hand filter/30% accompaniment gain. Muting wins over solo. Pan is normalized for Web Audio. */
export function mixEvent(
  event: { voice: number; gain: number },
  channels: readonly MixerChannel[],
) {
  const channel = channels[event.voice] ?? defaultChannel();
  return {
    gain: event.gain * channelLevel(event.voice, channels),
    pan: channel.pan / 100,
    timbre: channel.timbre,
  };
}
export function mixerPrograms(channels: readonly MixerChannel[]): (number | undefined)[] {
  return channels.map((c) => (c.timbreChanged ? TIMBRES[c.timbre].program : undefined));
}
/** Bus level for one voice (0–1): volume, or 0 when muted / another voice is soloed. Live-updatable. */
export function channelLevel(voice: number, channels: readonly MixerChannel[]): number {
  const channel = channels[voice] ?? defaultChannel();
  const audible = !channel.mute && (!channels.some((c) => c.solo) || channel.solo);
  return audible ? channel.volume / 100 : 0;
}
/** One voice, nothing touched: the practice panel shows the mixer folded (one line, 「展开混音台」). */
export function mixerFolds(channels: readonly MixerChannel[]): boolean {
  if (channels.length !== 1) return false;
  const c = channels[0];
  return c.volume === 100 && !c.mute && !c.solo && c.pan === 0 && !c.timbreChanged;
}
