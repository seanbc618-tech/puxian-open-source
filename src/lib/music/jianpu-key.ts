import { transposeKey, type KeyName } from "./theory.ts";

/** Chinese numbered notation puts the accidental before the tonic letter. */
export function writtenJianpuKey(key: KeyName, shift = 0): string {
  const written = transposeKey(key, shift);
  return (written === "F#" && (key === "F" || key.includes("b")) ? "Gb" : written)
    .replace(/([A-G])b/, "♭$1");
}
