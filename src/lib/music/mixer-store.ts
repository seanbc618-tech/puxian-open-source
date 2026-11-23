import { alignMixer, type MixerChannel } from "./mixer.ts";
export const MIXER_STORE_KEY = "puxian-mixer-v1";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function read(storage: Store) {
  try {
    const value = JSON.parse(storage.getItem(MIXER_STORE_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
export function loadMixer(storage: Store | undefined, song: string, count: number): MixerChannel[] {
  return alignMixer(storage && song ? read(storage)[song]?.channels : undefined, count);
}
export function saveMixer(
  storage: Store | undefined,
  song: string,
  channels: readonly MixerChannel[],
  now = Date.now(),
) {
  if (!storage || !song) return;
  const all = read(storage);
  const clean = alignMixer(channels, channels.length);
  if (
    clean.every(
      (c) =>
        c.volume === 100 &&
        !c.mute &&
        !c.solo &&
        !c.pan &&
        c.timbre === "piano" &&
        !c.timbreChanged,
    )
  )
    delete all[song];
  else
    Object.defineProperty(all, song, {
      value: { channels: clean, at: now },
      enumerable: true,
      configurable: true,
    });
  const kept = Object.entries(all)
    .filter(
      ([, v]) =>
        v && typeof v === "object" && Array.isArray((v as { channels?: unknown }).channels),
    )
    .sort(([, a], [, b]) => ((b as { at: number }).at || 0) - ((a as { at: number }).at || 0))
    .slice(0, 50);
  try {
    if (kept.length) storage.setItem(MIXER_STORE_KEY, JSON.stringify(Object.fromEntries(kept)));
    else storage.removeItem(MIXER_STORE_KEY);
  } catch {
    /* Quota/private mode: keep the current session usable. */
  }
}
